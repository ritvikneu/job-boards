#!/bin/bash
echo "+-------------------------------------------------------------+"
echo "|                                                             |"
echo "|                    Install Docker                           |"
echo "|                                                             |"
echo "+-------------------------------------------------------------+"
echo "sudo apt update"
sudo apt update

echo "install prerequisite packages which let apt use packages over HTTPS"
sudo apt install apt-transport-https ca-certificates curl gnupg2 software-properties-common -y

echo "add the GPG key for the official Docker repository to your system"
curl -fsSL https://download.docker.com/linux/debian/gpg

echo "add the Docker repository to APT sources"
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/debian $(lsb_release -cs) stable" -y

echo "update the package database with the Docker packages from the newly added repo"
sudo apt update

echo "install Docker"
apt-cache policy docker-ce -y

echo "install Docker"
sudo apt install docker-ce -y

# building docker image
# docker build -t ritvikdocker/jb:2.0 .
# running docker container
# docker run -d --name=jobs -p 8080:7777 ritvikdocker/jb:2.0