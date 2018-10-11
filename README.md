static-front-auth
===

static-front-auth is the Lambda@Edge function adding authentication to static web site which is hosted by CloudFront.  
The authentication is served by AWS Cognito.

# Development

## Requirements

* Node.js 8.x
  * Lambda@Edge supports up to 8.x
* Yarn
* GNU make
* AWS CLI

# Deployment

## Prerequisites

* Setup static web site hosted by CloudFront.
* Setup user pool of Cognito.
* Create DynamoDB table which stores session.
  * The table must contain primary key which is named 'id'.
* Create Lambda Function and its role.
  * The role must have permissions logs/dynamodb
  * The function must be created in us-east-1 region for limitation of Lamda@Edge.

## Steps

1. Make dist package.
   ```bash
   $ yarn --prod
   $ make
   ```

1. Update lambda. (Lambda function must be exist)
   ```bash
   $ aws lambda update-function-code --function-name static-front-auth --publish --zip-file fileb://dist/static-front-auth.zip 
   ```

1. Assign lambda to CloudFront distribution trigger.
 * Assign event type 'viewer-request'

# My Environment

* macOS Mojave
* Node.js 8.12.0
  * Yarn 1.10.1
* GNU Make 3.81
* AWS CLI 1.16.20
