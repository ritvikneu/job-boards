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

echo "Node version"
node -v

echo "PNPM setup"
wget -qO- https://get.pnpm.io/install.sh 
