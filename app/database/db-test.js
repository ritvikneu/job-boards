import Workday from "./Workday.js";
import User from "./user.js";

export const createAndRetrieveUser = async function createAndRetrieveUser() {
    try {
        // Create a new user
        const newUser = await User.create({
            username: 'testuser',
            email: 'testuser@example.com'
        });
        console.log('New user created:', newUser.toJSON());

        // Retrieve the user
        const retrievedUser = await User.findOne({ where: { username: 'testuser' } });
        console.log('Retrieved user:', retrievedUser.toJSON());

        return retrievedUser;
    } catch (error) {
        console.error('Error in createAndRetrieveUser:', error);
        throw error;
    }
}

export const createAndRetrieveWorkday = async function createAndRetrieveWorkday() {
    try {
        const newWorkday = await Workday.create({
            Job_URL: 'https://example.com/job1',
            Posting_Date: new Date(),
            CompanyName: 'Example Corp',
            Title: 'Software Engineer',
            Location: 'New York',
            Country: 'USA',
            JobId: 'JOB001',
            FilterStatus: 'Active'
        });
        console.log('New Workday entry created:', newWorkday.toJSON());

        const retrievedWorkday = await Workday.findOne({ where: { Job_URL: 'https://example.com/job1' } });
        console.log('Retrieved Workday entry:', retrievedWorkday.toJSON());

        return retrievedWorkday;
    } catch (error) {
        console.error('Error in createAndRetrieveWorkday:', error);
        throw error;
    }
}

export const testModels =  async function testModels() {
    try {
        // await createAndRetrieveUser();
        // console.log('User data:', use.toJSON());
        
        const workday = await createAndRetrieveWorkday();
        console.log('Workday data:', workday.toJSON());
    } catch (error) {
        console.error('Error in testModels:', error);
    }
}
