#!/bin/bash
cd /opt/boarduser/job-boards
touch .env
echo "launching=true" >> .env
echo "NODE_ENV=${NODE_ENV}" >> .env
echo 


echo 'Downloading the CloudWatch Agent package...'
sudo wget https://s3.amazonaws.com/amazoncloudwatch-agent/debian/amd64/latest/amazon-cloudwatch-agent.deb
 
echo 'Installing the CloudWatch Agent package...'
sudo dpkg -i -E ./amazon-cloudwatch-agent.deb
 
echo 'Enabling the CloudWatch Agent service...'
sudo systemctl enable amazon-cloudwatch-agent
sudo systemctl start amazon-cloudwatch-agent
sudo systemctl status amazon-cloudwatch-agent

sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config  -m ec2 -c file:/opt/boarduser/job-boards/app/middleware/cloudwatch-config.json -s
  


/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.d