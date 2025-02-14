import "@aws-cdk/assert/jest"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs"
import { App, RemovalPolicy, SecretValue, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { ApiGateway } from ".."
import { LoadBalancer } from "../../load-balancer"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { FargateService, ListenerRule } from "../../ecs"
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Queue } from "aws-cdk-lib/aws-sqs"
import { Function, InlineCode, Runtime } from "aws-cdk-lib/aws-lambda"

describe("HTTP API Gateway", () => {
  const albListenerHostName = "my-test-service-behind-alb.example.com"
  // These are set by the beforeEach below the tests.
  let stack: Stack
  let supportStack: Stack
  let vpc: ec2.Vpc
  let hostedZone: route53.HostedZone
  let loadBalancer: LoadBalancer
  let loadBalancerSecurityGroup: ec2.SecurityGroup

  const accessLogs = {
    removalPolicy: RemovalPolicy.RETAIN,
    retention: RetentionDays.SIX_MONTHS,
  }

  test("creates API-GW HTTP API using IAM auth and ALB integration", () => {
    // The loadbalancer security group MUST have an egress rule to the API-GW.
    // Check the createEcsAlbService method for this.
    createEcsAlbService()

    const apiGw = new ApiGateway(stack, "TestAlbApiGateway", {
      dns: { subdomain: "my-test-alb-api", hostedZone },
      defaultIntegration: {
        type: "ALB",
        loadBalancerListener: loadBalancer.httpsListener,
        hostName: albListenerHostName,
        securityGroup: loadBalancerSecurityGroup,
        vpc,
      },
      defaultAuthorization: { type: "IAM" },
      routes: [{ path: "/api" }],
      accessLogs,
    })

    // An external API consumer's AWS account, which we allow access:
    const externalAccountId = "12312312"
    /** The IAM user needs to assume this role in order to invoke the API. */
    const externalCallerRole = new iam.Role(stack, "ApigwExternalCallerRole", {
      assumedBy: new iam.CompositePrincipal(
        new iam.AccountPrincipal(externalAccountId),
        // add all the external accounts/roles here!
      ),
      description: `Allows external users to access the API-GW for '${apiGw.domain}' if they can assume this role.`,
    })
    apiGw.grantInvoke(externalCallerRole)

    expect(stack).toMatchCdkSnapshot()
  })

  test("creates API-GW HTTP API using basic auth and SQS integration", () => {
    const credentialsSecret = createBasicAuthCredentialsSecret()

    const ingressSqsQueue = new Queue(stack, "IngressQueue", {
      queueName: "api-ingress-queue",
      fifo: false,
    })

    new ApiGateway(stack, "TestSqsApiGateway", {
      dns: { subdomain: "my-test-sqs-api", hostedZone },
      defaultIntegration: { type: "SQS", queue: ingressSqsQueue },
      defaultAuthorization: {
        type: "BASIC_AUTH",
        credentialsSecretName: credentialsSecret.secretName,
      },
      routes: [{ path: "/api/queue/add" }],
      accessLogs,
    })

    expect(stack).toMatchCdkSnapshot()
  })

  test("creates API-GW HTTP API with no auth and Lambda integration", () => {
    const apiLambda = new Function(stack, "MyApiLambda", {
      vpc: vpc,
      code: new InlineCode(
        `exports.handler = async(event) => { return "Hello World"; }`,
      ),
      handler: "index.handler",
      runtime: Runtime.NODEJS_22_X,
    })

    new ApiGateway(stack, "TestLambdaApiGateway", {
      dns: { subdomain: "my-test-lambda-api", hostedZone },
      defaultIntegration: { type: "Lambda", lambda: apiLambda },
      defaultAuthorization: { type: "NONE" },
      routes: [{ path: "/api/hello" }],
      accessLogs,
    })

    expect(stack).toMatchCdkSnapshot()
  })

  test("creates API-GW HTTP API with Cognito User Pool authorizer", () => {
    createEcsAlbService()
    const userPool = createCognitoUserPool()
    const credentialsSecret = createBasicAuthCredentialsSecret()

    new ApiGateway(stack, "TestApiGatewayWithCognitoUserPoolAuth", {
      dns: { subdomain: "my-test-api-with-cognito-user-pool-auth", hostedZone },
      defaultIntegration: {
        type: "ALB",
        loadBalancerListener: loadBalancer.httpsListener,
        hostName: albListenerHostName,
        securityGroup: loadBalancerSecurityGroup,
        vpc,
      },
      defaultAuthorization: {
        type: "COGNITO_USER_POOL",
        userPool,
        requiredScope: "example/read_users",
        credentialsForInternalAuthorization: credentialsSecret.secretName,
      },
      routes: [{ path: "/api" }],
      accessLogs,
    })

    expect(stack).toMatchCdkSnapshot()
  })

  test("creates API-GW HTTP API with Cognito User Pool/Basic Auth authorizer", () => {
    createEcsAlbService()
    const userPool = createCognitoUserPool()
    const credentialsSecret = createBasicAuthCredentialsSecret()

    new ApiGateway(stack, "TestApiGatewayWithCognitoUserPoolAuth", {
      dns: {
        subdomain: "my-test-api-with-cognito-user-pool-or-basic-auth",
        hostedZone,
      },
      defaultIntegration: {
        type: "ALB",
        loadBalancerListener: loadBalancer.httpsListener,
        hostName: albListenerHostName,
        securityGroup: loadBalancerSecurityGroup,
        vpc,
      },
      defaultAuthorization: {
        type: "COGNITO_USER_POOL_OR_BASIC_AUTH",
        userPool,
        basicAuthCredentialsSecretName: credentialsSecret.secretName,
        requiredScope: "example/read_users",
      },
      routes: [{ path: "/api" }],
      accessLogs,
    })

    expect(stack).toMatchCdkSnapshot()
  })

  test("creates API-GW HTTP API with custom Lambda authorizer", () => {
    createEcsAlbService()

    const lambdaAuthorizer = new lambdaNodejs.NodejsFunction(
      stack,
      "LambdaAuthorizer",
      {
        code: lambda.Code.fromInline(`
export async function handler(event) {
  return { isAuthorized: false }
}       
`),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_LATEST,
      },
    )

    new ApiGateway(stack, "TestApiGatewayWithCognitoUserPoolAuth", {
      dns: {
        subdomain: "my-test-api-with-cognito-user-pool-or-basic-auth",
        hostedZone,
      },
      defaultIntegration: {
        type: "ALB",
        loadBalancerListener: loadBalancer.httpsListener,
        hostName: albListenerHostName,
        securityGroup: loadBalancerSecurityGroup,
        vpc,
      },
      defaultAuthorization: {
        type: "CUSTOM_LAMBDA_AUTHORIZER",
        lambdaAuthorizer,
        authorizerProps: {
          authorizerName: "my-custom-authorizer",
          identitySource: ["$request.header.X-Api-Key"],
        },
      },
      routes: [{ path: "/api" }],
      accessLogs,
    })

    expect(stack).toMatchCdkSnapshot()
  })

  beforeEach(() => {
    const app = new App()
    supportStack = new Stack(app, "SupportStack", {
      env: { region: "eu-west-1" },
    })
    stack = new Stack(app, "Stack", { env: { region: "eu-west-1" } })

    vpc = new ec2.Vpc(supportStack, "Vpc")

    hostedZone = new route53.HostedZone(supportStack, "HostedZone", {
      zoneName: "example.com",
    })
  })

  function createEcsAlbService() {
    const certificate = new cm.Certificate(supportStack, "Certificate", {
      domainName: `*.example.com`,
      subjectAlternativeNames: ["example.com"],
      validation: cm.CertificateValidation.fromDns(hostedZone),
    })

    loadBalancerSecurityGroup = new ec2.SecurityGroup(
      supportStack,
      "LoadBalancerSecurityGroup",
      { vpc: vpc, allowAllOutbound: false },
    )

    // VERY IMPORTANT! Or your api-gw fails silently when invoking it
    loadBalancerSecurityGroup.addEgressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(443),
      "Outbound to self for ALB to API-GW VPC-Link",
    )

    loadBalancer = new LoadBalancer(supportStack, "LoadBalancer", {
      certificates: [certificate],
      vpc: vpc,
      overrideLoadBalancerProps: { securityGroup: loadBalancerSecurityGroup },
    })

    const ecsCluster = new ecs.Cluster(supportStack, "Cluster", { vpc })

    const ecrRepository = new ecr.Repository(supportStack, "Repository", {
      repositoryName: "example-repository",
    })

    const service = new FargateService(stack, "Service", {
      serviceName: "example-service",
      vpc: vpc,
      cluster: ecsCluster,
      desiredCount: 2,
      parameters: [],
      ecsImage: ecs.ContainerImage.fromEcrRepository(
        ecrRepository,
        "exampleEcrTag",
      ),
    })

    new ListenerRule(stack, "Dns", {
      domainName: albListenerHostName,
      hostedZone: hostedZone,
      httpsListener: loadBalancer.httpsListener,
      listenerPriority: 10,
      loadBalancer: loadBalancer.loadBalancer,
      targetGroup: service.targetGroup!,
    })
  }

  function createCognitoUserPool(): cognito.IUserPool {
    return new cognito.UserPool(stack, "UserPool")
  }

  function createBasicAuthCredentialsSecret(): ISecret {
    // Don't do this in your stack - use a cli script to set secrets.
    new Secret(stack, "BasicAuthCredentialsSecret", {
      secretName:
        "/example/cdk/prod/myService/myservice.gateway.auth.basic.credentials",
      secretStringValue: SecretValue.unsafePlainText(
        `{"username":"test-user","password":"test-password"}`,
      ),
    })

    // Load a referenced secret that is already set
    return Secret.fromSecretNameV2(
      stack,
      "BasicAuthCredentials",
      `/example/cdk/prod/myService/myservice.gateway.auth.basic.credentials`,
    )
  }
})
