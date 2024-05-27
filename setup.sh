#!/bin/bash
echo "+-------------------------------------------------------------+"
echo "|                                                             |"
echo "|                    Install NodeJS and NPM                   |"
echo "|                                                             |"
echo "+-------------------------------------------------------------+"
echo "sudo apt update"
sudo apt update 

echo "Node and pnpm"
sudo apt install nodejs npm -y

echo "Node and npm version version"
node -v
npm -v

echo "+-------------------------------------------------------------+"
echo "|                                                             |"
echo "|                    Setup boarduser                         |"
echo "|                                                             |"
echo "+-------------------------------------------------------------+"
sudo groupadd boardsgroup
sudo useradd -s /bin/false -g boardsgroup -d /opt/boarduser -m boarduser




echo "+-------------------------------------------------------------+"
echo "|                                                             |"
echo "|                    UNZIP job-boards                             |"
echo "|                                                             |"
echo "+-------------------------------------------------------------+"
sudo apt update
sudo apt install unzip

echo "check job-boards in home directory"
ls
echo "cp job-boards to user home directory"
sudo cp -r  job-boards.zip /opt/job-boards

cd /opt/job-boards

echo "unzip in opt/job-boa"
sudo unzip job-boards.zip

echo "----Checking if the file exists----"
ls 


echo "+-------------------------------------------------------------+"
echo "|                                                             |"
echo "|                    Install Node Modules                     |"
echo "|                                                             |"
echo "+-------------------------------------------------------------+"
echo "cd to job-boards to install node modules"
cd job-boards
sudo npm install



# echo "+-------------------------------------------------------------+"
# echo "|                                                             |"
# echo "|                    Install Docker                           |"
# echo "|                                                             |"
# echo "+-------------------------------------------------------------+"
# echo "sudo apt update"
# sudo apt update

# echo "install prerequisite packages which let apt use packages over HTTPS"
# sudo apt install apt-transport-https ca-certificates curl gnupg2 software-properties-common -y

# echo "add the GPG key for the official Docker repository to your system"
# curl -fsSL https://download.docker.com/linux/debian/gpg

# echo "add the Docker repository to APT sources"
# sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/debian $(lsb_release -cs) stable" -y

# echo "update the package database with the Docker packages from the newly added repo"
# sudo apt update

# echo "install Docker"
# apt-cache policy docker-ce -y

# echo "install Docker"
# sudo apt install docker-ce -y