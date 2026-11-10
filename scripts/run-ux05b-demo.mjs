// Reuses the audited ephemeral launcher, its database guards and disabled delivery jobs.
process.env.DENTALCLINIC_UX05B = '1';
await import('./run-ux05a-demo.mjs');
