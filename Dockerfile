FROM node:21.7.1

# set the working directory in the container
WORKDIR /app

# Copy the package.json file to the root directory of container
COPY package*.json ./

# Install all the dependencies - this starts up a shell and runs the command
RUN npm install

# Copy the rest of the files
COPY . .

# Set the environment variable for the container    
ENV PORT=7777

# Expose the port to the outside world
EXPOSE 7777

# Command to run the application - written as array of strings called as Exec Form
# doesnot start a shell and executes the command directly
CMD ["node", "server.js"]

