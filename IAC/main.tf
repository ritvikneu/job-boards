
# create a VPC with 3 public and 3 private subnets
resource "aws_vpc" "vpc" {
    cidr_block = var.cidr_block
    enable_dns_support = true
    enable_dns_hostnames = true
    tags = {
    Name = "${var.prefix_name}-vpc"
    }
}


resource "aws_subnet" "public_subnet" {
    count = var.subnet_public_count
    vpc_id = aws_vpc.vpc.id
    cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
    availability_zone = data.aws_availability_zones.available.names[count.index]
    map_public_ip_on_launch = true
    tags = {
    Name = "${var.prefix_name}-public-subnet-${count.index}"
    }
}

resource "aws_subnet" "private_subnet" {
    count = var.subnet_private_count
    vpc_id = aws_vpc.vpc.id
    cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
    availability_zone = data.aws_availability_zones.available.names[count.index]
    map_public_ip_on_launch = false
    tags = {
    Name = "${var.prefix_name}-private-subnet-${count.index}"
    }
}