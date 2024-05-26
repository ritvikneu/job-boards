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