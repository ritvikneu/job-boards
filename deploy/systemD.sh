#!/bin/bash
echo "+-------------------------------------------------------------+"
echo "|                                                             |"
echo "|                    setup new user permissions               |"
echo "|                                                             |"
echo "+-------------------------------------------------------------+"

echo "get the home directory of user"
echo ~boarduser
# sudo -u boarduser bash
echo "display permissions of user directory"
ls -la /opt/boarduser

echo "change permissions of job-boards"
sudo chown -R boarduser:boardsgroup /opt/boarduser/job-boards
sudo chmod -R 750  /opt/boarduser/job-boards

echo "display permissions of user directory"
ls -la /opt/boarduser

echo "+-------------------------------------------------------------+"
echo "|                                                             |"
echo "|                    Setup Systemd                            |"
echo "|                                                             |"
echo "+-------------------------------------------------------------+"

cd 
sudo systemctl start job-boards
sudo systemctl restart job-boards
sudo systemctl status job-boards
sudo systemctl enable job-boards