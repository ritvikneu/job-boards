import AWS from 'aws-sdk';
import { config } from 'dotenv';
import e from 'express';
config();

let aws_remote_config = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.REGION
}

AWS.config.update(aws_remote_config);

const dynamoDB = new AWS.DynamoDB.DocumentClient();


export const addJobstoDynamoDB = async ({ link, title, jobId, location, datePosted, companyName, portalName, isTitle, isLocation, isDatePosted }) => {
    const params = {
        TableName: process.env.DYNAMODB_TABLE_NAME,
        // key:{
        //     job_link : link
        // },
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
    await dynamoDB.put(params).promise();
}

// export const getJobsfromDynamoDB = async function getJobsfromDynamoDB(job_link) {
//     const params = {
//         TableName: process.env.DYNAMODB_TABLE_NAME
//     };
//     // job_link is the key of the dynamodb
//     const data = await dynamoDB.get(params).promise();
// }

export const getJobfromDynamoDB = async (job_link) => {
    const params = {
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Key: {
            job_link: job_link
        }
    };

    try {
        const data = await dynamoDB.get(params).promise();
        // if the job link exists in the table return data.item
        if (data.Item) {
            return data.Item;
        }
        else{
            return null
        }
    } catch (error) {
        console.error(`Error fetching job from DynamoDB with link ${job_link}:`, error);
        throw error;
    }
};

