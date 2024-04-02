import  express  from "express";
import * as jobsController from "./../controllers/jobs-controller.js";

const router = express.Router();

router.route('/')
        .get(jobsController.get);
        
        
export default router;