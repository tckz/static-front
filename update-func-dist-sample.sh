#!/bin/bash

# THIS IS SAMPLE
# DON'T APPLY TO YOUR ENV WITHOUT UNDERSTADING BEHAVIOR.

func_arc=fileb://dist/static-front-auth.zip

while getopts d:f: c
do
	case $c in
		d)
			dist_id=$OPTARG
			;;
		f)
			func_name=$OPTARG
			;;
		\?)
			exit 1
			;;
	esac
done

shift $((OPTIND - 1))

if [[ -z $dist_id ]]
then
	echo "*** -d distribution_id must be specified." 1>&2
	exit 1
fi

if [[ -z $func_name ]]
then
	echo "*** -f lambda_func_name must be specified." 1>&2
	exit 1
fi


echo "### yarn --prod" 1>&2
yarn --prod
rc=$?
if [[ $rc != 0 ]]
then
	echo "*** yarn exit=$rc" 1>&2
	exit 1
fi

echo "### make func archive" 1>&2
make
rc=$?
if [[ $rc != 0 ]]
then
	echo "*** make exit=$rc" 1>&2
	exit 1
fi

echo "### update-function-code: $func_name" 1>&2
resp=`aws --region us-east-1 lambda update-function-code --function-name $func_name --publish --zip-file $func_arc`
rc=$?
if [[ $rc != 0 ]]
then
	echo "*** update-function-code exit=$rc" 1>&2
	exit 1
fi

func_arn=`echo "$resp" | jq -r .FunctionArn`
echo "ARN=$func_arn" 1>&2

echo "### get-distribution config: $dist_id" 1>&2
resp=`aws cloudfront get-distribution --id $dist_id`
rc=$?
if [[ $rc != 0 ]]
then
	echo "*** get-distribution exit=$rc" 1>&2
	exit 1
fi

etag=`echo $resp | jq -r .ETag`
cur_conf=`echo $resp | jq .Distribution.DistributionConfig`
new_conf=`echo $cur_conf | jq --arg arn $func_arn '.DefaultCacheBehavior.LambdaFunctionAssociations.Items |= map(
			if .EventType == "viewer-request" then 
				.LambdaFunctionARN=$arn 
			else 
				. 
			end)
'`

echo "### update-distribution config: $dist_id, etag=$etag" 1>&2
aws cloudfront update-distribution --id $dist_id --if-match $etag --distribution-config "$new_conf"
rc=$?
if [[ $rc != 0 ]]
then
	echo "*** update-distribution exit=$rc" 1>&2
	exit 1
fi


