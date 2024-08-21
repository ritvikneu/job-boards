// workday-db-controller.js
import { dbService } from './db-service.js';

class WorkdayDbController {
  constructor() {
    this.Job = dbService.Job;
  }

  // Create a new job or update if it already exists
  async createOrUpdateJob(jobData) {
    try {
      const [job, created] = await this.Job.upsert(jobData, { returning: true });
      return { job, created };
    } catch (error) {
      console.error('Error in createOrUpdateJob:', error);
      throw error;
    }
  }

  // Read a job by its URL
  async getJobByUrl(jobUrl) {
    try {
      return await this.Job.findByPk(jobUrl);
    } catch (error) {
      console.error('Error in getJobByUrl:', error);
      throw error;
    }
  }

  // Read all jobs
  async getAllJobs() {
    try {
      return await this.Job.findAll();
    } catch (error) {
      console.error('Error in getAllJobs:', error);
      throw error;
    }
  }

  // Read jobs by company name
  async getJobsByCompany(companyName) {
    try {
      return await this.Job.findAll({
        where: { company_name: companyName }
      });
    } catch (error) {
      console.error('Error in getJobsByCompany:', error);
      throw error;
    }
  }

  // Update filter status
  async updateFilterStatus(jobUrl, filterStatus) {
    try {
      const [updatedRowsCount, updatedJobs] = await this.Job.update(
        { filter_status: filterStatus },
        { where: { job_url: jobUrl }, returning: true }
      );
      return updatedJobs[0];
    } catch (error) {
      console.error('Error in updateFilterStatus:', error);
      throw error;
    }
  }

  // Delete a job
  async deleteJob(jobUrl) {
    try {
      const deletedRowsCount = await this.Job.destroy({
        where: { job_url: jobUrl }
      });
      return deletedRowsCount > 0;
    } catch (error) {
      console.error('Error in deleteJob:', error);
      throw error;
    }
  }

  // Get jobs by filter status
  async getJobsByFilterStatus(filterStatus) {
    try {
      return await this.Job.findAll({
        where: { filter_status: filterStatus }
      });
    } catch (error) {
      console.error('Error in getJobsByFilterStatus:', error);
      throw error;
    }
  }

  // Get jobs posted after a certain date
  async getJobsPostedAfter(date) {
    try {
      return await this.Job.findAll({
        where: {
          posting_date: {
            [Op.gte]: date
          }
        }
      });
    } catch (error) {
      console.error('Error in getJobsPostedAfter:', error);
      throw error;
    }
  }

  // Count jobs by company
  async countJobsByCompany() {
    try {
      return await this.Job.findAll({
        attributes: ['company_name', [Sequelize.fn('COUNT', Sequelize.col('job_url')), 'job_count']],
        group: ['company_name']
      });
    } catch (error) {
      console.error('Error in countJobsByCompany:', error);
      throw error;
    }
  }
}

export const workdayDbController = new WorkdayDbController();