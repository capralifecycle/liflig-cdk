import datetime
import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

import boto3
from boto3.session import Session

s3 = boto3.client("s3")
codepipeline = boto3.client("codepipeline")
ssm = boto3.client("ssm")


def get_variables_from_parameters(namespace):
    next_token = None
    result = {}

    prefix = f"/liflig-cdk/{namespace}/pipeline-variables/"
    params = {
        "Path": prefix,
    }

    while True:
        if next_token is not None:
            params["NextToken"] = next_token
        response = ssm.get_parameters_by_path(**params)

        parameters = response["Parameters"]
        if len(parameters) == 0:
            break

        for parameter in parameters:
            result[parameter["Name"][len(prefix) :]] = parameter["Value"]

        if "NextToken" not in response:
            break
        next_token = response["NextToken"]

    return result


def handler(event, context):
    job = event["CodePipeline.job"]
    job_id = job["id"]

    try:
        user_parameters = json.loads(
            job["data"]["actionConfiguration"]["configuration"]["UserParameters"]
        )

        files = s3.list_objects_v2(
            Bucket=user_parameters["bucketName"],
            Prefix=user_parameters["prefix"],
        )

        def get_data(key):
            result = s3.get_object(Bucket=user_parameters["bucketName"], Key=key)
            return result["Body"].read()

        cdk_source_ref = None
        now = datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc)
        variables = {
            # Special variable that can be used when reading variables
            # to ensure it is not stale. In the pipeline, variables
            # will never be stale, but locally it can be.
            "variablesTimestamp": now.isoformat(),
        }

        for file in files.get("Contents", []):
            key = file["Key"]
            filename = key[len(user_parameters["prefix"]) :]

            print(f"File: {filename}")

            if filename == "cdk-source.json":
                cdk_source_ref = json.loads(get_data(key))
            elif re.match(r"^variables.*\.json$", filename):
                # Legacy variables from S3 scoped only to this pipeline.
                # Consider removing this later.
                # See https://jira.capraconsulting.no/browse/CALS-408 for context
                variables.update(json.loads(get_data(key)))
            else:
                print("Ignoring unknown file")

        if cdk_source_ref is None:
            raise Exception("cdk-source.json not found")

        # Modern variables from Parameter Store.
        variables.update(
            get_variables_from_parameters(user_parameters["parametersNamespace"])
        )

        s3_loc = job["data"]["outputArtifacts"][0]["location"]["s3Location"]

        temp_dir = tempfile.mkdtemp()

        with tempfile.NamedTemporaryFile() as tmp_file:
            s3.download_file(
                Bucket=cdk_source_ref["bucketName"],
                Key=cdk_source_ref["bucketKey"],
                Filename=tmp_file.name,
            )

            print(f"Downloaded zip size: {os.path.getsize(tmp_file.name)}")

            with zipfile.ZipFile(tmp_file.name, "r") as zip_file:
                zip_file.extractall(temp_dir)

        for name, value in variables.items():
            print(f"Variable: {name}={value}")

        Path(os.path.join(temp_dir, "variables.json")).write_text(json.dumps(variables))

        with tempfile.NamedTemporaryFile() as tmp_file:
            with zipfile.ZipFile(tmp_file.name, "w", zipfile.ZIP_DEFLATED) as zip_file:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        fullpath = os.path.join(root, file)
                        arcname = str(Path(fullpath).relative_to(temp_dir))
                        print(f"Adding {arcname}")
                        zip_file.write(filename=fullpath, arcname=arcname)

            credentials = job["data"]["artifactCredentials"]
            s3_upload_client = Session(
                aws_access_key_id=credentials["accessKeyId"],
                aws_secret_access_key=credentials["secretAccessKey"],
                aws_session_token=credentials["sessionToken"],
            ).client("s3")

            print(f"Generated zip size: {os.path.getsize(tmp_file.name)}")

            s3_upload_client.upload_file(
                Filename=tmp_file.name,
                Bucket=s3_loc["bucketName"],
                Key=s3_loc["objectKey"],
            )

        shutil.rmtree(temp_dir)

        codepipeline.put_job_success_result(
            jobId=job_id,
        )

        print("Success")
    except Exception as e:
        codepipeline.put_job_failure_result(
            jobId=job_id,
            failureDetails={
                "message": str(e),
                "type": "JobFailed",
                "externalExecutionId": context.aws_request_id,
            },
        )

        print(f"Failed: ${e}")
