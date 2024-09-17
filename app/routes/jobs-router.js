import express from "express";
import * as jobsController from "./../controllers/jobs-controller.js";

const router = express.Router();

// router.route('/')
//         .get(jobsController.get);

router.route('/greenhouse')
        .get(jobsController.getGreenhouse);
// router.route('/greenembed')
//         .get(jobsController.getGreenhouseEmbed);
router.route('/lever')
        .get(jobsController.getLever);
router.route('/workday')
        .get(jobsController.getWorkday);
router.route('/dice')
        .get(jobsController.getDice);
router.route('/oracloud')
        .get(jobsController.getOraCloud);
router.route('/latest')
        .get(jobsController.getLatestJobs);
router.route('/health')
        .get(jobsController.HealthCheck);


export default router;