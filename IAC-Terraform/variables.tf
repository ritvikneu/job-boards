variable "region" {
  type    = string
  default = "us-east-1"
}
variable "profile" {
  type    = string
  default = "dev"
}



variable "cidr_block" {
  type    = string
  default = "10.0.0.0/16"
}

variable "gateway_route" {
  type    = string
  default = "0.0.0.0/0"
}

variable "slash_notion" {
  type    = number
  default = 8
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
  // TODO: Auto-retrive availability zones
}

variable "subnet_public_count" {
  type    = number
  default = 3
}
variable "subnet_private_count" {
  type    = number
  default = 3
}

variable "prefix_name" {
  type    = string
  default = "dev"
}

data "aws_availability_zones" "available" {
  state = "available"
}


variable "ingress_ports" {
  type    = list(number)
  default = [22, 7777]
}

variable "ingress_ports_lb" {
  type    = list(number)
  default = [80, 443]
}

variable "ami_id" {
  type    = string
  default = "ami-07beb4e6e5e36e153"
}

variable "key_name" {
  type    = string
  default = "amiKeypair"
}

variable "instance_type" {
  type    = string
  default = "t2.large"
  
}