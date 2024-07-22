import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { config } from 'dotenv';
import e from 'express';
config();

const awsRemoteConfig = {
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    region: process.env.REGION
};

const client = new DynamoDBClient(awsRemoteConfig);
const dynamoDB = DynamoDBDocumentClient.from(client);

export const addJobstoDynamoDB = async ({ link, title, jobId, location, datePosted, companyName, portalName, isTitle, isLocation, isDatePosted }) => {
    const params = {
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Item: {
            job_link: link,
            title,
            jobId,
            location,
            datePosted,
            companyName,
            portalName,
            isTitle,
            isLocation,
            isDatePosted
        }
    };
    await dynamoDB.send(new PutCommand(params));
};

export const getJobfromDynamoDB = async (job_link) => {
    const params = {
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Key: {
            job_link: job_link
        }
    };

    try {
        const { Item } = await dynamoDB.send(new GetCommand(params));
        return Item || null;
    } catch (error) {
        console.error(`Error fetching job from DynamoDB with link ${job_link}:`, error);
        throw error;
    }
};