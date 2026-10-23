import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'tests/e2e',timeout:60000,expect:{timeout:15000},fullyParallel:false,workers:1,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:3018',viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'node apps/server/dist/index.js',url:'http://127.0.0.1:3018/api/health',env:{PORT:'3018',DATA_DIR:'.openexcel/e2e',STATIC_DIR:'apps/web/dist'},reuseExistingServer:false,timeout:30000},
});
