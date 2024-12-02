# Job Boards - Distributed Job Posting Aggregation System

## Overview
A high-performance distributed system designed to aggregate and process job postings from multiple companies' Job Portals and career pages. The system implements a producer-consumer architecture using RabbitMQ as the message broker, enabling efficient parallel processing and scalable job data handling.

## Key Features
- **Multi-source Data Aggregation**: Fetches job postings from multiple Job Portals and career pages
- **Distributed Processing**: Uses RabbitMQ for distributed job processing
- **Intelligent Filtering**: Advanced filtering based on multiple criteria
- **Parallel Processing**: Concurrent job fetching and processing
- **Rate Limiting**: Smart rate limiting with retry mechanisms
- **Robust Error Handling**: Comprehensive error management and resilience
- **Performance Optimized**: Batch processing and configurable concurrency

## System Architecture

### 1. Data Input Layer
- JSON-based company data management
- Built-in validation and deduplication
- Efficient file I/O operations

### 2. Job Fetching Layer
- Workday, Oracle Cloud, Greenhouse, Lever, Dice job portal API integration
- Offset-based pagination support
- Configurable filter criteria, including location, job title, and posting date
- Rate limiting and retry mechanisms
- Standardized job posting format

### 3. Message Queue Layer
- RabbitMQ-based message broker
- Concurrent and Parallel Processing
- Producer-consumer pattern implementation
- Batch processing support
- Reliable message acknowledgment

### 4. Processing Layer
- Multi-criteria job filtering
- Location validation
- Posting date verification
- Job title validation

### 5. Output Layer
- Excel report generation
- Comprehensive logging
- Performance metrics tracking

## Performance Features

### Concurrency
- Parallel job fetching across companies
- Dynamic consumer scaling (1-10 consumers)
- Batch processing (150 messages per consumer)
- Formula-based consumer scaling: `Math.ceil(jobPostings.length / 1500) + 1`

### Rate Limiting
- MaxConcurrent: 5 requests
- MinTime: 1000ms between requests
- Exponential backoff retry mechanism
- Maximum 3 retries with calculated delays

## Setup and Configuration

### Prerequisites
- Node.js
- RabbitMQ Server
- Required NPM packages (see package.json)
- Docker
- Postman

### Environment Variables
- **Job Filtering**
  - `JOB_TITLES`: List of job titles to search for
  - `IGNORE_TITLES`: List of titles to exclude from results
  - `POSTING_DIFF`: Number of days for job posting freshness
  - `COUNTRIES`, `STATES`, `STATES_ABBR`: Location filtering options
  - `COUNTRIES_CA`, `STATES_CA`, `STATES_ABBR_CA`: Canadian location options

- **API Configuration**
  - `WORKDAY_OFFSET`: Pagination offset for Workday API
  - `MAILTRAP_TOKEN`: Authentication token for email notifications
  - `CONCURRENCY_LIMIT`: Maximum concurrent API requests

- **Storage Configuration**
  - `DYNAMODB_TABLE_NAME`: DynamoDB table for data storage
  - `FILE_NAME`, `FILE_GH`, `FILE_ASH`, `FILE_EMBED`, `FILE_LEVER`, `FILE_WDAY`, `FILE_ORACLOUD`: Input file configurations for different Job Portals

- **System Configuration**
  - `VALID_PARTS`: Validation parameter length for filtering Job Titles 
  - `HEALTH_CHECK`: Health check response message

## Monitoring and Logging
- Execution time tracking
- Rate limit monitoring
- Error counting and tracking
- Queue depth monitoring
- Operation timestamps

## Error Handling
- Automatic retry mechanisms
- Error tracking and logging
- Graceful degradation
- Queue-based message recovery

## Scalability
- Horizontal scaling support
- Configurable consumer counts
- Independent process scaling
- Environment-based tuning

## Contributing
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License
[Add License Information]

## Contact
[Add Contact Information]