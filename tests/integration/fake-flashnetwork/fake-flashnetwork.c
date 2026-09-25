// TEST DOUBLE for Flashforge's FlashNetwork library. Not a printer and not
// Flashforge code: it is compiled against Flashforge's published FlashNetwork.h
// (fetched by build.sh) so its struct layouts match the real library, which
// lets the agent's FFI bindings be tested end to end. One fake printer:
// serial SNFAKE0001, check code 12345678, 127.0.0.1:8899.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "FlashNetwork.h"

static const char *SN = "SNFAKE0001";
static const char *CODE = "12345678";
static int state = 0; // 0 ready, 1 printing, 2 pause, 3 completed, 4 error
static double progress = 0;
static char FORCE[512] = "force";
static void apply_force(void) {
  FILE *f = fopen(FORCE, "r");
  if (!f) return;
  int s = -1;
  if (fscanf(f, "%d", &s) == 1 && s >= 0 && s <= 4) { state = s; if (s == 3) progress = 1.0; if (s == 0) progress = 0; }
  fclose(f);
  remove(FORCE);
}
static char lastFile[512] = "";
static char logPath[512] = "calls.log"; /* set by fake_init from FAKE_FNET_DIR */

static void logf_(const char *fmt, const char *a, const char *b) {
  FILE *f = fopen(logPath, "a"); if (!f) return; fprintf(f, fmt, a, b); fprintf(f, "\n"); fclose(f);
}
static int auth(const char *ip, unsigned short port, const char *sn, const char *code) {
  if (strcmp(ip, "127.0.0.1") != 0 || port != 8899) return FNET_ERROR;
  if (strcmp(sn, SN) != 0 || strcmp(code, CODE) != 0) return 1001;
  return 0;
}
static char *dup(const char *s) { char *r = malloc(strlen(s) + 1); strcpy(r, s); return r; }

int fnet_initlize(const char *p, const fnet_log_settings_t *l) {
  const char *dir = getenv("FAKE_FNET_DIR");
  if (dir) {
    snprintf(logPath, sizeof logPath, "%s/calls.log", dir);
    snprintf(FORCE, sizeof FORCE, "%s/force", dir);
  }
  logf_("init %s %s", p, l ? l->fileDir : "(null)");
  return 0;
}
void fnet_uninitlize() {}
const char *fnet_getVersion() { return "fake-3.0.0"; }
void fnet_setUserAgent(const char *u) {}

int fnet_getLanDevList(fnet_lan_dev_info_t **infos, int *cnt, int ms) {
  fnet_lan_dev_info_t *a = calloc(2, sizeof(fnet_lan_dev_info_t));
  strcpy(a[0].serialNumber, SN); strcpy(a[0].name, "AD5X-Fake"); strcpy(a[0].ip, "127.0.0.1"); a[0].port = 8899; a[0].pid = 38; a[0].connectMode = 0;
  strcpy(a[1].serialNumber, "SNOTHER"); strcpy(a[1].name, "5M"); strcpy(a[1].ip, "10.0.0.9"); a[1].port = 8899; a[1].pid = 36; a[1].connectMode = 1;
  *infos = a; *cnt = 2; return 0;
}
void fnet_freeLanDevInfos(fnet_lan_dev_info_t *infos) { free(infos); }

int fnet_getLanDevProduct(const char *ip, unsigned short port, const char *sn, const char *code, fnet_dev_product_t **p, int ms) {
  int rc = auth(ip, port, sn, code); if (rc) return rc;
  fnet_dev_product_t *x = calloc(1, sizeof(*x)); x->nozzleTempCtrlState = 1; x->platformTempCtrlState = 1; x->lightCtrlState = 1; *p = x; return 0;
}
void fnet_freeDevProduct(fnet_dev_product_t *p) { free(p); }

int fnet_getLanDevDetail(const char *ip, unsigned short port, const char *sn, const char *code, fnet_dev_detail_t **out, int ms) {
  int rc = auth(ip, port, sn, code); if (rc) return rc;
  apply_force();
  if (state == 1) { progress += 0.1; if (progress >= 0.999) { progress = 1.0; state = 3; } }
  fnet_dev_detail_t *d = calloc(1, sizeof(*d));
  d->devId = dup("dev1"); d->pid = 38; d->nozzleCnt = 1; d->measure = dup("220x220x220"); d->nozzleModel = dup("0.4");
  d->firmwareVersion = dup("1.1.7"); d->macAddr = dup("88:A9:A7:00:00:01"); d->ipAddr = dup("127.0.0.1"); d->name = dup("AD5X-Fake");
  d->camera = 2; d->location = dup(""); 
  const char *st[] = {"ready", "printing", "pause", "completed", "error"};
  d->status = dup(st[state]);
  d->coordinate[0] = 1.5; d->coordinate[1] = 2.5; d->coordinate[2] = 3.5;
  d->jobId = dup(state ? "job-77" : ""); d->printFileName = dup(state ? lastFile : ""); d->printFileThumbUrl = dup("");
  d->printLayer = state ? 42 : 0; d->targetPrintLayer = state ? 200 : 0; d->printProgress = state ? progress : 0;
  d->rightTemp = 219.5; d->rightTargetTemp = 220; d->leftTemp = 0; d->leftTargetTemp = 0;
  d->nozzleTemps = NULL; d->nozzleTargetTemps = NULL;
  d->platTemp = 59.8; d->platTargetTemp = 60; d->chamberTemp = 0; d->chamberTargetTemp = 0;
  d->fillAmount = 15; d->zAxisCompensation = 0.02; d->rightFilamentType = dup("PLA"); d->leftFilamentType = dup("");
  d->currentPrintSpeed = 100; d->printSpeedAdjust = 100; d->printDuration = state ? 3600 * progress : 0; d->estimatedTime = state ? 5000 : 0;
  d->estimatedRightLen = 1000; d->estimatedLeftLen = 0; d->estimatedRightWeight = 12.5; d->estimatedLeftWeight = 0;
  d->coolingFanSpeed = 100; d->coolingFanLeftSpeed = 0; d->chamberFanSpeed = 0;
  d->hasRightFilament = 1; d->hasLeftFilament = 0; d->hasMatlStation = 1;
  d->matlStationInfo.slotCnt = 4; d->matlStationInfo.currentSlot = 2; d->matlStationInfo.currentLoadSlot = 2; d->matlStationInfo.stateAction = 4; d->matlStationInfo.stateStep = 0;
  d->matlStationInfo.slotInfos = calloc(4, sizeof(fnet_matl_slot_info_t));
  const char *cols[] = {"#FFFFFF", "#000000", "#FF0000", ""};
  for (int i = 0; i < 4; i++) { d->matlStationInfo.slotInfos[i].slotId = i + 1; d->matlStationInfo.slotInfos[i].hasFilament = i < 3; d->matlStationInfo.slotInfos[i].materialName = dup(i < 3 ? "PLA" : ""); d->matlStationInfo.slotInfos[i].materialColor = dup(cols[i]); }
  d->indepMatlInfo.stateAction = 0; d->indepMatlInfo.materialName = dup("PLA"); d->indepMatlInfo.materialColor = dup("#FFFFFF");
  d->internalFanStatus = dup("open"); d->externalFanStatus = dup("close"); d->clearFanStatus = dup("close"); d->doorStatus = dup("close");
  d->lightStatus = dup("open"); d->autoShutdown = dup("close"); d->autoShutdownTime = 30; d->tvoc = 1; d->remainingDiskSpace = 6.25;
  d->cumulativePrintTime = 4321; d->cumulativeFilament = 98765; d->cameraStreamUrl = dup(""); d->polarRegisterCode = dup(""); d->flashRegisterCode = dup("");
  d->errorCode = dup(state == 4 ? "E0801" : "");
  *out = d; return 0;
}
void fnet_freeDevDetail(const fnet_dev_detail_t *d) { /* leak strings in test double */ free((void *)d); }

int fnet_lanDevSendGcode(const char *ip, unsigned short port, const char *sn, const char *code, const fnet_send_gcode_data_t *g, int ms) {
  int rc = auth(ip, port, sn, code); if (rc) return rc;
  if (state != 0) return 2;
  FILE *f = fopen(g->gcodeFilePath, "rb"); if (!f) return 3; fclose(f);
  FILE *lf = fopen(logPath, "a");
  fprintf(lf, "send path=%s dst=%s printNow=%d level=%d flow=%d first=%d tl=%d matl=%d tools=%d thumb=%s ms=%d\n", g->gcodeFilePath, g->gcodeDstName, g->printNow,
    g->levelingBeforePrint, g->flowCalibration, g->firstLayerInspection, g->timeLapseVideo, g->useMatlStation, g->gcodeToolCnt, g->thumbFilePath ? g->thumbFilePath : "(null)", ms);
  for (int i = 0; i < g->gcodeToolCnt; i++) fprintf(lf, "map tool=%d slot=%d name=%s tc=%s sc=%s\n", g->materialMappings[i].toolId, g->materialMappings[i].slotId,
    g->materialMappings[i].materialName, g->materialMappings[i].toolMaterialColor, g->materialMappings[i].slotMaterialColor);
  fclose(lf);
  strncpy(lastFile, g->gcodeDstName, sizeof(lastFile) - 1);
  if (g->printNow) { state = 1; progress = 0; }
  return 0;
}

int fnet_ctrlLanDevJob(const char *ip, unsigned short port, const char *sn, const char *code, const fnet_job_ctrl_t *j, int ms) {
  int rc = auth(ip, port, sn, code); if (rc) return rc;
  logf_("job %s %s", j->jobId, j->action);
  if (strcmp(j->jobId, "job-77") != 0) return FNET_ERROR;
  if (!strcmp(j->action, "pause")) state = 2; else if (!strcmp(j->action, "continue")) state = 1; else if (!strcmp(j->action, "cancel")) { state = 0; progress = 0; } else return FNET_ERROR;
  return 0;
}
int fnet_ctrlLanDevState(const char *ip, unsigned short port, const char *sn, const char *code, const fnet_state_ctrl_t *s, int ms) {
  int rc = auth(ip, port, sn, code); if (rc) return rc;
  logf_("state %s%s", s->action, "");
  if (!strcmp(s->action, "setClearPlatform") && state == 3) { state = 0; progress = 0; }
  return 0;
}
// test hook: force the simulated state
void fake_set_state(int s) { state = s; }
