/** Client-safe job label (the service module is server-only). */
export const jobLabel = (job: { job_number: number }) => `JOB-${String(job.job_number).padStart(4, "0")}`;
