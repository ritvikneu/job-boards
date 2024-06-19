#!/bin/bash
cd /opt/boarduser/job-boards
touch .env
echo "launching=true" >> .env
echo "NODE_ENV=${NODE_ENV}" >> .env