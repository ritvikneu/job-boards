#!/bin/bash
cd /opt/boarduser/job-boards
touch .env
echo "launching=true" >> .env
echo "NODE_ENV=${NODE_ENV}" >> .env


sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config  -m ec2 -c file:/opt/boarduser/job-boards/app/middleware/cloudwatch-config.json -s
  
