# create a VPC with 3 public and 3 private subnets
resource "aws_vpc" "vpc_tf" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    Name = "${var.prefix_name}-vpc"
  }
}

resource "aws_subnet" "public_subnet" {
  count                   = var.subnet_public_count
  vpc_id                  = aws_vpc.vpc_tf.id
  cidr_block              = cidrsubnet(aws_vpc.vpc_tf.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = {
    Name = "${var.prefix_name}-public-subnet-${count.index}"
  }
}

resource "aws_subnet" "private_subnet" {
  count                   = var.subnet_private_count
  vpc_id                  = aws_vpc.vpc_tf.id
  cidr_block              = cidrsubnet(aws_vpc.vpc_tf.cidr_block, 8, count.index + var.subnet_public_count)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false
  tags = {
    Name = "${var.prefix_name}-private-subnet-${count.index}"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.vpc_tf.id
  tags = {
    Name = "${var.prefix_name}-igw"
  }
}

resource "aws_route_table" "public_route_table" {
  vpc_id = aws_vpc.vpc_tf.id
  route {
    cidr_block = var.gateway_route
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = {
    Name = "${var.prefix_name}-public-route-table"
  }
}

resource "aws_route_table_association" "public_route_table_association" {
  count          = var.subnet_public_count
  subnet_id      = aws_subnet.public_subnet[count.index].id
  route_table_id = aws_route_table.public_route_table.id
}

resource "aws_route_table" "private_route_table" {
  count  = var.subnet_private_count
  vpc_id = aws_vpc.vpc_tf.id
  route {
    cidr_block = var.gateway_route
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = {
    Name = "${var.prefix_name}-private-route-table"
  }
}

resource "aws_route_table_association" "private_route_table_association" {
  count          = var.subnet_private_count
  subnet_id      = aws_subnet.private_subnet[count.index].id
  route_table_id = aws_route_table.private_route_table[count.index].id
}

# # create rds parameters group to be used for postgres
# resource "aws_db_parameter_group" "db_parameter_group" {
#   name   = "db-parameter-group"
#   family = "postgres15"
#   tags = {
#     Name = "${var.prefix_name}-db-parameter-group"
#   }
# }

# # Create an rds instance in private subnet for postgres
# resource "aws_db_subnet_group" "db_subnet_group" {
#   name       = "db_subnet_group"
#   subnet_ids = aws_subnet.private_subnet[*].id
#   tags = {
#     Name = "${var.prefix_name}-db-subnet-group"
#   }
# }

# # create postgres db security group
# resource "aws_security_group" "db_sg" {
#   name        = "db_sg"
#   description = "security group for postgres db"
#   vpc_id      = aws_vpc.vpc_tf.id
#   ingress {
#     from_port   = 5432
#     to_port     = 5432
#     protocol    = "tcp"
#     cidr_blocks = ["0.0.0.0/0"]
#   }
#   egress {
#     from_port   = 0
#     to_port     = 0
#     protocol    = "-1"
#     cidr_blocks = ["0.0.0.0/0"]
#   }
#   tags = {
#     Name = "${var.prefix_name}-db-sg"
#   }
# }

# # create an rds instance in private subnet for postgres
# resource "aws_db_instance" "db_instance" {
#   allocated_storage      = 10
#   engine                 = "postgres"
#   engine_version         = "15"
#   instance_class         = "db.t3.micro"
#   db_name                = "postgres"
#   username               = "postgres"
#   password               = "postgres"
#   db_subnet_group_name   = aws_db_subnet_group.db_subnet_group.id
#   vpc_security_group_ids = [aws_security_group.db_sg.id]
#   parameter_group_name   = aws_db_parameter_group.db_parameter_group.id
#   skip_final_snapshot    = true
#   publicly_accessible    = true
#   tags = {
#     Name = "${var.prefix_name}-db"
#   }
# }



# create a Iam role for the instances
resource "aws_iam_role" "aws_ec2_role" {
  name = "ec2_role_boards"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = "RoleForEC2"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      },
    ]
  })
}

# create an instance profile for the ec2 role
resource "aws_iam_instance_profile" "aws_ec2_instance_profile" {
  name = "ec2_instance_profile_boards"
  role = aws_iam_role.aws_ec2_role.name
}
# create a security group for the instances
resource "aws_security_group" "instance_sg" {
  vpc_id = aws_vpc.vpc_tf.id
  ingress {
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    cidr_blocks     = ["0.0.0.0/0"]
    security_groups = [aws_security_group.load_balancer_sg.id]
  }
  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    cidr_blocks     = ["0.0.0.0/0"]
    security_groups = [aws_security_group.load_balancer_sg.id]
  }
  ingress {
    from_port       = 7777
    to_port         = 7777
    protocol        = "tcp"
    cidr_blocks     = ["0.0.0.0/0"]
    security_groups = [aws_security_group.load_balancer_sg.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = {
    Name = "${var.prefix_name}-instance-sg"
  }
}

# attach cloudwatch agent policy to the ec2 iam role
resource "aws_iam_role_policy_attachment" "cloudwatch_agent_policy_attachment" {
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
  role       = aws_iam_role.aws_ec2_role.name
}

# create Ec2 instances
# resource "aws_instance" "ec2_instance" {
#   count                  = 1
#   ami                    = var.ami_id
#   instance_type          = var.instance_type
#   key_name               = var.key_name
#   subnet_id              = aws_subnet.public_subnet[0].id
#   vpc_security_group_ids = [aws_security_group.instance_sg.id]
#   iam_instance_profile   = aws_iam_instance_profile.aws_ec2_instance_profile.name
#   tags = {
#     Name = "${var.prefix_name}-instance-${count.index}"
#   }
# }

# create a load balancer security group
resource "aws_security_group" "load_balancer_sg" {
  name        = "load balancer"
  description = "Allow TCP inbound traffic"
  vpc_id      = aws_vpc.vpc_tf.id

  tags = {
    Name = "load balancer group"
  }
  # ingress {
  #   from_port   = 22
  #   to_port     = 22
  #   protocol    = "tcp"
  #   cidr_blocks = ["0.0.0.0/0"]
  #   }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

}


# create a load balancer
resource "aws_lb" "load_balancer" {
  name               = "boards-lb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.load_balancer_sg.id]
  subnets            = [for subnet in aws_subnet.public_subnet : subnet.id]
  tags = {
    Name = "boards-lb"
  }
}

# create a target group
resource "aws_lb_target_group" "target_group" {
  name        = "boards-tg"
  port        = 7777
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.vpc_tf.id
  health_check {
    path                = "/health"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30

  }
  tags = {
    Name = "boards-tg"
  }
}

# create a listener
resource "aws_lb_listener" "lb_listener" {
  load_balancer_arn = aws_lb.load_balancer.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.target_group.arn
  }
}

# create a EC2 launch template
resource "aws_launch_template" "ec2_launch_template" {

  name          = "boards-launch-template"
  image_id      = var.ami_id
  instance_type = var.instance_type
  key_name      = var.key_name
  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.instance_sg.id]
    subnet_id                   = aws_subnet.public_subnet[0].id
  }
  monitoring {
    enabled = true
  }
  iam_instance_profile {
    name = aws_iam_instance_profile.aws_ec2_instance_profile.name
  }
  block_device_mappings {
    device_name = "/dev/xvdg"
    ebs {
      delete_on_termination = false
      volume_size           = 100
      volume_type           = "gp2"
    }
  }
  disable_api_termination = true
  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "boards-launch-template"
    }
  }
  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    NODE_ENV = "development"

  }))
}

# create a auto scaling group
resource "aws_autoscaling_group" "asg" {
  desired_capacity = 1
  max_size         = 5
  min_size         = 1
  force_delete     = true
  default_cooldown = 60
  launch_template {
    id      = aws_launch_template.ec2_launch_template.id
    version = "$Latest"
  }
  target_group_arns   = [aws_lb_target_group.target_group.arn]
  vpc_zone_identifier = [for subnet in aws_subnet.public_subnet : subnet.id]
  tag {
    key                 = "boards-asg"
    value               = "job-boards-asg"
    propagate_at_launch = true
  }
}

# create a scaling policy
resource "aws_autoscaling_policy" "scale_up_policy" {
  name                   = "scale-up"
  scaling_adjustment     = 1
  adjustment_type        = "ChangeInCapacity"
  cooldown               = 60
  autoscaling_group_name = aws_autoscaling_group.asg.name
}

resource "aws_autoscaling_policy" "scale_down_policy" {
  name                   = "scale-down"
  scaling_adjustment     = -1
  adjustment_type        = "ChangeInCapacity"
  cooldown               = 60
  autoscaling_group_name = aws_autoscaling_group.asg.name
}

output "ami_id" {
  value = var.ami_id
}

output "lb_dns_name" {
  value = aws_lb.load_balancer.dns_name

}
