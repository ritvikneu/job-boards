packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = ">= 1.0.0"
    }
  }
}

variable "AWS_REGION" {
  type    = string
  default = "us-east-1"
}

variable "source_ami" {
  type    = string
  default = "ami-06db4d78cb1d3bbf9"
}

// variable "PGPassword" {
//   type    = string
//   default = "password"
// }

variable "SSH_USERNAME" {
  type    = string
  default = "admin"
}

// variable "subnet_id" {
//   type    = string
//   default = "subnet-0ad2f289e66bbe333"
// }

variable "INSTANCE_TYPE" {
  type    = string
  default = "t2.micro"
}

variable "AMI_DESCRIPTION" {
  type    = string
  default = "Debian AMI"
}

variable "PROFILE" {
  type    = string
  default = "dev"
}

variable "VOLUME_TYPE" {
  type    = string
  default = "gp2"
}

variable "VOLUME_SIZE" {
  type    = number
  default = 8
}

variable "DEVICE_NAME" {
  type    = string
  default = "/dev/xvda"
}

variable "AMI_SOURCE_NAME" {
  type    = string
  default = "debian-12-amd64-*"
}

variable "AMI_SOURCE_DEVICE_TYPE" {
  type    = string
  default = "ebs"
}

variable "AMI_SOURCE_VIRTUALIZATION" {
  type    = string
  default = "hvm"
}

variable "AMI_USERS" {
  type    = list(string)
  default = ["686811303427", "038666155741"]
}

source "amazon-ebs" "my-ami2" {
  // region          = "${var.AWS_REGION}"
  ami_name        = "${var.AMI_DESCRIPTION}_${formatdate("YYYY_MM_DD_hh_mm_ss", timestamp())}"
  profile         = "${var.PROFILE}"
  ami_description = "${var.AMI_DESCRIPTION}"
  ami_users       = "${var.AMI_USERS}" ## DEV & DEMO users listed here
  // aws_polling {
  //   delay_seconds = 30
  //   max_attempts  = 50
  // }
  instance_type = "${var.INSTANCE_TYPE}"
  // source_ami    = "${var.source_ami}"
  source_ami_filter {
    filters = {
      name                = "${var.AMI_SOURCE_NAME}"
      root-device-type    = "${var.AMI_SOURCE_DEVICE_TYPE}"
      virtualization-type = "${var.AMI_SOURCE_VIRTUALIZATION}"
    }
    most_recent = true
    owners      = ["amazon"]
  }
  ssh_username = "${var.SSH_USERNAME}"
  vpc_filter {
    filters = {
      "isDefault" : "true"
    }
  }

  launch_block_device_mappings {
    delete_on_termination = true
    device_name           = "${var.DEVICE_NAME}"
    volume_size           = "${var.VOLUME_SIZE}"
    volume_type           = "${var.VOLUME_TYPE}"
    # encrypted            = true 
  }
}

build {
  sources = ["source.amazon-ebs.my-ami2"]


  provisioner "file" {
    source      = "job-boards.zip"
    destination = "~/job-boards.zip"
  }

  // provisioner "file" {
  //   source      = "webapp.service"
  //   destination = "~/webapp.service"
  // }

  // provisioner "file" {
  //   source      = "cloudwatch-config.json"
  //   destination = "~/cloudwatch-config.json"
  // }

  // provisioner "shell" {
  //   scripts = [
  //     "./setup.sh",
  //   ]
  // }

  // provisioner "shell" {
  //   scripts = [
  //     "./systemD.sh",
  //   ]
  // }

  post-processor "manifest" {
    output     = "manifest.json"
    strip_path = true
  }


}