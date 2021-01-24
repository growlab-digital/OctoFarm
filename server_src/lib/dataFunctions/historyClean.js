const ServerSettings = require("../../models/ServerSettings.js");
const History = require("../../models/History.js");
const Logger = require("../logger.js");

const logger = new Logger("OctoFarm-InformationCleaning");
let historyClean = [];
let statisticsClean = {
  completed: 0,
  cancelled: 0,
  failed: 0,
  longestPrintTime: 0,
  shortestPrintTime: 0,
  averagePrintTime: 0,
  mostPrintedFile: 0,
  printerMost: 0,
  printerLoad: 0,
  totalFilamentUsage: 0,
  averageFilamentUsage: 0,
  highestFilamentUsage: 0,
  lowestFilamentUsage: 0,
  totalSpoolCost: 0,
  highestSpoolCost: 0,
  totalPrinterCost: 0,
  highestPrinterCost: 0,
  currentFailed: 0,
};

class HistoryClean {
  static returnHistory() {
    return historyClean;
  }

  static returnStatistics() {
    return statisticsClean;
  }

  static async start() {
    logger.info("Running history Cleaning");
    const history = await History.find({}, null, {
      sort: { historyIndex: -1 },
    });
    const historyArray = [];
    for (let h = 0; h < history.length; h++) {
      const sorted = {
        _id: history[h]._id,
        index: history[h].printHistory.historyIndex,
        state: HistoryClean.getState(
          history[h].printHistory.success,
          history[h].printHistory.reason
        ),
        printer: history[h].printHistory.printerName,
        file: HistoryClean.getFile(history[h].printHistory),
        startDate: history[h].printHistory.startDate,
        endDate: history[h].printHistory.endDate,
        printTime: history[h].printHistory.printTime,
        notes: history[h].printHistory.notes,
        printerCost: HistoryClean.getPrintCost(
          history[h].printHistory.printTime,
          history[h].printHistory.costSettings
        ),
        spools: await HistoryClean.getSpool(
          history[h].printHistory.filamentSelection,
          history[h].printHistory.job,
          history[h].printHistory.success,
          history[h].printHistory.printTime
        ),
        thumbnail: history[h].printHistory.thumbnail,
        job: await HistoryClean.getJob(
          history[h].printHistory.job,
          history[h].printHistory.printTime
        ),
      };

      if (
        typeof history[h].printHistory.resends !== "undefined" &&
        history[h].printHistory.resends !== null
      ) {
        sorted.resend = history[h].printHistory.resends;
      }
      if (typeof history[h].printHistory.snapshot !== "undefined") {
        sorted.snapshot = history[h].printHistory.snapshot;
      }
      if (typeof history[h].printHistory.timelapse !== "undefined") {
        sorted.timelapse = history[h].printHistory.timelapse;
      }
      let spoolCost = 0;
      let totalVolume = 0;
      let totalLength = 0;
      let totalWeight = 0;
      const numOr0 = (n) => (isNaN(n) ? 0 : parseFloat(n));
      if (typeof sorted.spools !== "undefined" && sorted.spools !== null) {
        const keys = Object.keys(sorted.spools);
        for (let s = 0; s < sorted.spools.length; s++) {
          if (typeof sorted.spools[s]["tool" + keys[s]] !== "undefined") {
            spoolCost += numOr0(sorted.spools[s]["tool" + keys[s]].cost);
            totalVolume += numOr0(sorted.spools[s]["tool" + keys[s]].volume);
            totalLength += numOr0(sorted.spools[s]["tool" + keys[s]].length);
            totalWeight += numOr0(sorted.spools[s]["tool" + keys[s]].weight);
          }
        }
      }
      spoolCost = numOr0(spoolCost);
      sorted.totalCost = (
        parseFloat(sorted.printerCost) + parseFloat(spoolCost)
      ).toFixed(2);
      sorted.costPerHour =
        parseFloat(sorted.totalCost) /
        parseFloat((history[h].printHistory.printTime / 360000) * 100);
      if (isNaN(sorted.costPerHour)) {
        sorted.costPerHour = 0;
      }
      sorted.printHours = await HistoryClean.getHours(
        history[h].printHistory.printTime
      );
      if (!isNaN(sorted.costPerHour)) {
        sorted.costPerHour = sorted.costPerHour.toFixed(2);
      }
      sorted.totalVolume = parseFloat(totalVolume);

      sorted.totalLength = parseFloat(totalLength);
      sorted.totalWeight = parseFloat(totalWeight);
      sorted.spoolCost = parseFloat(spoolCost);
      historyArray.push(sorted);
    }
    historyClean = historyArray;
    statisticsClean = await HistoryClean.getStatistics(historyArray);
    logger.info("History information cleaned and ready for consumption");
  }

  static checkNested(nameKey, myArray) {
    for (var i = 0; i < myArray.length; i++) {
      if (myArray[i].name === nameKey) {
        return myArray[i];
      }
    }
  }
  static checkNestedIndex(nameKey, myArray) {
    for (var i = 0; i < myArray.length; i++) {
      if (myArray[i].name === nameKey) {
        return i;
      }
    }
  }

  static async getStatistics(historyClean) {
    let lastThirtyDays = [];
    let date = new Date();

    let thirtyDaysAgo = date.getDate() - 30;
    date.setDate(thirtyDaysAgo);
    thirtyDaysAgo = date;

    function arrayCounts(arr) {
      const a = [];
      const b = [];
      let prev;

      arr.sort();
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] !== prev) {
          a.push(arr[i]);
          b.push(1);
        } else {
          b[b.length - 1]++;
        }
        prev = arr[i];
      }

      return [a, b];
    }
    const completed = [];
    const cancelled = [];
    const failed = [];
    const printTimes = [];
    const fileNames = [];
    const printerNames = [];
    const filamentWeight = [];
    const filamentLength = [];
    const printCost = [];
    const filamentCost = [];
    const arrayFailed = [];

    const usageOverTime = [];
    const totalByDay = [];
    const historyByDay = [];

    for (let h = 0; h < historyClean.length; h++) {
      if (historyClean[h].state.includes("success")) {
        completed.push(true);
        printTimes.push(historyClean[h].printTime);

        fileNames.push(historyClean[h].file.name);

        printerNames.push(historyClean[h].printer);

        filamentWeight.push(historyClean[h].totalWeight);
        filamentLength.push(historyClean[h].totalLength);

        printCost.push(parseFloat(historyClean[h].printerCost));
      } else if (historyClean[h].state.includes("warning")) {
        cancelled.push(true);
        arrayFailed.push(historyClean[h].printTime);
      } else if (historyClean[h].state.includes("danger")) {
        failed.push(true);
        arrayFailed.push(historyClean[h].printTime);
      }

      filamentCost.push(historyClean[h].spoolCost);
      historyClean[h].spools.forEach((spool) => {
        //console.log(spool);
        const keys = Object.keys(spool);
        for (const key of keys) {
          //check if type exists
          let checkNested = this.checkNested(spool[key].type, totalByDay);

          if (typeof checkNested !== "undefined") {
            let checkNestedIndexHistoryRates = null;
            if (historyClean[h].state.includes("success")) {
              checkNestedIndexHistoryRates = this.checkNestedIndex(
                "Success",
                historyByDay
              );
            } else if (historyClean[h].state.includes("warning")) {
              checkNestedIndexHistoryRates = this.checkNestedIndex(
                "Cancelled",
                historyByDay
              );
            } else if (historyClean[h].state.includes("danger")) {
              checkNestedIndexHistoryRates = this.checkNestedIndex(
                "Failed",
                historyByDay
              );
            }

            let checkNestedIndexByDay = this.checkNestedIndex(
              spool[key].type,
              usageOverTime
            );
            let usageWeightCalc = 0;

            if (
              typeof usageOverTime[checkNestedIndexByDay].data[0] !==
              "undefined"
            ) {
              usageWeightCalc =
                usageOverTime[checkNestedIndexByDay].data[
                  usageOverTime[checkNestedIndexByDay].data.length - 1
                ].y + historyClean[h].totalWeight;
            } else {
              usageWeightCalc = historyClean[h].totalWeight;
            }

            let checkNestedIndex = this.checkNestedIndex(
              spool[key].type,
              totalByDay
            );
            let dateSplit = historyClean[h].endDate.split(" ");
            const months = [
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ];
            let month = months.indexOf(dateSplit[1]);
            let dateParse = new Date(
              parseInt(dateSplit[3]),
              month + 1,
              parseInt(dateSplit[2])
            );
            let weightCalcSan = parseFloat(
              historyClean[h].totalWeight.toFixed(2)
            );
            let dateChecked = new Date(thirtyDaysAgo);
            //Don't include 0 weights
            if (weightCalcSan > 0) {
              //Check if more than 30 days ago...
              if (dateParse > dateChecked) {
                totalByDay[checkNestedIndex].data.push({
                  x: dateParse.toLocaleDateString(),
                  y: weightCalcSan,
                });
                usageOverTime[checkNestedIndex].data.push({
                  x: dateParse.toLocaleDateString(),
                  y: usageWeightCalc,
                });
                // console.log(checkNestedIndexHistoryRates);
                // console.log(historyByDay[checkNestedIndexHistoryRates].name);
                historyByDay[checkNestedIndexHistoryRates].data.push({
                  x: dateParse.toLocaleDateString(),
                  y: 1,
                });
              }
            }
          } else {
            let usageKey = {
              name: spool[key].type,
              data: [],
            };
            let usageByKey = {
              name: spool[key].type,
              data: [],
            };
            let successKey = {
              name: "Success",
              data: [],
            };
            let cancellKey = {
              name: "Cancelled",
              data: [],
            };
            let failedKey = {
              name: "Failed",
              data: [],
            };

            if (spool[key].type !== "") {
              totalByDay.push(usageKey);
            }
            if (spool[key].type !== "") {
              usageOverTime.push(usageByKey);
            }
            if (typeof historyByDay[0] === "undefined") {
              historyByDay.push(successKey);
              historyByDay.push(cancellKey);
              historyByDay.push(failedKey);
            }
          }
        }
      });
    }
    function sumValuesGroupByDate(input) {
      var result = [];
      input.reduce(function (res, value) {
        if (!res[value.x]) {
          res[value.x] = { x: value.x, y: 0 };
          result.push(res[value.x]);
        }
        res[value.x].y += parseFloat(value.y);
        return res;
      }, {});
      return result;
      // var dates = {};
      // input.forEach((dv) => (dates[dv.x] = (dates[dv.x] || 0) + dv.y));
      // return Object.keys(dates).map((date) => ({
      //   x: new Date(parseInt(date)).toLocaleDateString(),
      //   y: dates[date],
      // }));
    }

    totalByDay.forEach((usage) => {
      usage.data = sumValuesGroupByDate(usage.data);
    });
    historyByDay.forEach((usage) => {
      usage.data = sumValuesGroupByDate(usage.data);
    });
    const totalFilamentWeight = filamentWeight.reduce((a, b) => a + b, 0);
    const totalFilamentLength = filamentLength.reduce((a, b) => a + b, 0);
    const filesArray = arrayCounts(fileNames);
    let mostPrintedFile = "No Files";
    if (filesArray[0].length !== 0) {
      const countFilesArray = filesArray[1].indexOf(Math.max(...filesArray[1]));
      mostPrintedFile = filesArray[0][countFilesArray];
      mostPrintedFile = mostPrintedFile.replace(/_/g, " ");
    }
    const printerNamesArray = arrayCounts(printerNames);
    let mostUsedPrinter = "No Printers";
    let leastUsedPrinter = "No Printers";
    if (printerNamesArray[0].length != 0) {
      const maxIndexPrinterNames = printerNamesArray[1].indexOf(
        Math.max(...printerNamesArray[1])
      );
      const minIndexPrinterNames = printerNamesArray[1].indexOf(
        Math.min(...printerNamesArray[1])
      );
      mostUsedPrinter = printerNamesArray[0][maxIndexPrinterNames];
      leastUsedPrinter = printerNamesArray[0][minIndexPrinterNames];
    }
    const statTotal = completed.length + cancelled.length + failed.length;

    const statistics = {
      completed: completed.length,
      cancelled: cancelled.length,
      failed: failed.length,
      completedPercent: ((completed.length / statTotal) * 100).toFixed(2),
      cancelledPercent: ((cancelled.length / statTotal) * 100).toFixed(2),
      failedPercent: ((failed.length / statTotal) * 100).toFixed(2),
      longestPrintTime: Math.max(...printTimes).toFixed(2),
      shortestPrintTime: Math.min(...printTimes).toFixed(2),
      averagePrintTime: (
        printTimes.reduce((a, b) => a + b, 0) / printTimes.length
      ).toFixed(2),
      mostPrintedFile,
      printerMost: mostUsedPrinter,
      printerLoad: leastUsedPrinter,
      totalFilamentUsage:
        totalFilamentWeight.toFixed(2) +
        "g / " +
        totalFilamentLength.toFixed(2) +
        "m",
      averageFilamentUsage:
        (totalFilamentWeight / filamentWeight.length).toFixed(2) +
        "g / " +
        (totalFilamentLength / filamentLength.length).toFixed(2) +
        "m",
      highestFilamentUsage:
        Math.max(...filamentWeight).toFixed(2) +
        "g / " +
        Math.max(...filamentLength).toFixed(2) +
        "m",
      lowestFilamentUsage:
        Math.min(...filamentWeight).toFixed(2) +
        "g / " +
        Math.min(...filamentLength).toFixed(2) +
        "m",
      totalSpoolCost: filamentCost.reduce((a, b) => a + b, 0).toFixed(2),
      highestSpoolCost: Math.max(...filamentCost).toFixed(2),
      totalPrinterCost: printCost.reduce((a, b) => a + b, 0).toFixed(2),
      highestPrinterCost: Math.max(...printCost).toFixed(2),
      currentFailed: arrayFailed.reduce((a, b) => a + b, 0),
      totalByDay: totalByDay,
      usageOverTime: usageOverTime,
      historyByDay: historyByDay,
    };
    return statistics;
  }
  static async getHours(printTime) {
    printTime = printTime * 1000;
    const h = Math.floor(printTime / 1000 / 60 / 60);
    const m = Math.floor((printTime / 1000 / 60 / 60 - h) * 60);
    const s = Math.floor(((printTime / 1000 / 60 / 60 - h) * 60 - m) * 60);
    return `${h}:${m}`;
  }
  static async getJob(job, printTime) {
    if (typeof job !== "undefined") {
      const accuracy =
        ((printTime - job.estimatedPrintTime) / printTime) * 10000;
      const newJob = {
        estimatedPrintTime: job.estimatedPrintTime,
        actualPrintTime: printTime,
        printTimeAccuracy: accuracy,
      };
      return newJob;
    } else {
      return null;
    }
  }

  static async getSpool(filamentSelection, metrics, success, time) {
    const serverSettings = await ServerSettings.find({});
    let printPercentage = 0;
    //Fix for old records
    if (
      typeof metrics !== "undefined" &&
      typeof metrics.filament !== "undefined" &&
      metrics.filament !== null
    ) {
      if (!success) {
        printPercentage = (time / metrics.estimatedPrintTime) * 100;
      }
      metrics = metrics.filament;
    } else {
      metrics = null;
    } //Get spoolname function
    function spoolName(id) {
      if (
        typeof id !== "undefined" &&
        id !== null &&
        typeof id.spools !== "undefined"
      ) {
        if (serverSettings[0].filamentManager) {
          return `${id.spools.name} (${(
            id.spools.weight - id.spools.used
          ).toFixed(0)}g) - ${id.spools.profile.material}`;
        } else {
          return `${id.spools.name} - ${id.spools.profile.material}`;
        }
      } else {
        return null;
      }
    }
    //Get spoolid function
    function spoolID(id) {
      if (typeof id !== "undefined" && id !== null) {
        return id._id;
      } else {
        return null;
      }
    }
    function getWeight(length, spool) {
      if (typeof spool !== "undefined" && spool !== null) {
        if (typeof length !== "undefined") {
          if (length === 0) {
            return length;
          } else {
            const radius = parseFloat(spool.spools.profile.diameter) / 2;
            const volume = length * Math.PI * radius * radius;
            let usage = "";
            if (success) {
              usage = (
                volume * parseFloat(spool.spools.profile.density)
              ).toFixed(2);
            } else {
              usage = (
                (printPercentage / 100) *
                (volume * parseFloat(spool.spools.profile.density))
              ).toFixed(2);
            }
            return usage;
          }
        } else {
          return 0;
        }
      } else {
        if (typeof length !== "undefined") {
          length = length;
          if (length === 0) {
            return length;
          } else {
            const radius = 1.75 / 2;
            const volume = length * Math.PI * radius * radius;
            let usage = "";
            if (success) {
              usage = (volume * 1.24).toFixed(2);
            } else {
              usage = ((printPercentage / 100) * (volume * 1.24)).toFixed(2);
            }
            return usage;
          }
        } else {
          return 0;
        }
      }
    }
    function getType(spool) {
      if (typeof spool !== "undefined" && spool !== null) {
        return spool.spools.profile.material;
      } else {
        return "";
      }
    }
    function getCost(grams, spool) {
      if (typeof spool !== "undefined" && spool !== null) {
        if (success) {
          return ((spool.spools.price / spool.spools.weight) * grams).toFixed(
            2
          );
        } else {
          return (
            (printPercentage / 100) *
            ((spool.spools.price / spool.spools.weight) * grams).toFixed(2)
          );
        }
      } else {
        return null;
      }
    }

    const spools = [];
    if (typeof metrics !== "undefined" && metrics !== null) {
      const keys = Object.keys(metrics);
      for (let m = 0; m < keys.length; m++) {
        let spool = {};
        if (success) {
          spool = {
            [keys[m]]: {
              toolName: "Tool " + keys[m].substring(4, 5),
              spoolName: null,
              spoolId: null,
              volume: metrics[keys[m]].volume.toFixed(2),
              length: (metrics[keys[m]].length / 1000).toFixed(2),
              weight: null,
              cost: null,
            },
          };
        } else {
          spool = {
            [keys[m]]: {
              toolName: "Tool " + keys[m].substring(4, 5),
              spoolName: null,
              spoolId: null,
              volume: (
                (printPercentage / 100) *
                metrics[keys[m]].volume
              ).toFixed(2),
              length: (
                ((printPercentage / 100) * metrics[keys[m]].length) /
                1000
              ).toFixed(2),
              weight: null,
              cost: null,
            },
          };
        }

        if (Array.isArray(filamentSelection)) {
          spool[keys[m]].spoolName = spoolName(filamentSelection[m]);
          spool[keys[m]].spoolId = spoolID(filamentSelection[m]);
          spool[keys[m]].weight = getWeight(
            metrics[keys[m]].length / 1000,
            filamentSelection[m]
          );
          spool[keys[m]].cost = getCost(
            spool[keys[m]].weight,
            filamentSelection[m]
          );

          spool[keys[m]].type = getType(filamentSelection[m]);
        } else {
          spool[keys[m]].spoolName = spoolName(filamentSelection);
          spool[keys[m]].spoolId = spoolID(filamentSelection);
          spool[keys[m]].weight = getWeight(
            metrics[keys[m]].length / 1000,
            filamentSelection
          );
          spool[keys[m]].cost = getCost(
            spool[keys[m]].weight,
            filamentSelection
          );
          spool[keys[m]].type = getType(filamentSelection);
        }
        spools.push(spool);
      }
      return spools;
    } else {
      return null;
    }
  }

  static getPrintCost(printTime, costSettings) {
    if (typeof costSettings === "undefined") {
      //Attempt to update cost settings in history...
      return "No cost settings to calculate from";
    } else {
      // calculating electricity cost
      const powerConsumption = parseFloat(costSettings.powerConsumption);
      const costOfElectricity = parseFloat(costSettings.electricityCosts);
      const costPerHour = powerConsumption * costOfElectricity;
      const estimatedPrintTime = printTime / 3600; // h
      const electricityCost = costPerHour * estimatedPrintTime;
      // calculating printer cost
      const purchasePrice = parseFloat(costSettings.purchasePrice);
      const lifespan = parseFloat(costSettings.estimateLifespan);
      const depreciationPerHour = lifespan > 0 ? purchasePrice / lifespan : 0;
      const maintenancePerHour = parseFloat(costSettings.maintenanceCosts);
      const printerCost =
        (depreciationPerHour + maintenancePerHour) * estimatedPrintTime;
      // assembling string
      const estimatedCost = electricityCost + printerCost;
      return estimatedCost.toFixed(2);
    }
  }

  static getFile(history) {
    const file = {
      name: history.fileName,
      uploadDate: null,
      path: null,
      size: null,
      averagePrintTime: null,
      lastPrintTime: null,
    };
    if (typeof history.job !== "undefined" && typeof history.job.file) {
      file.uploadDate = history.job.file.date;
      file.path = history.job.file.path;
      file.size = history.job.file.size;
      file.averagePrintTime = history.job.averagePrintTime;
      file.lastPrintTime = history.job.lastPrintTime;
    } else {
      file.path = history.filePath;
    }
    return file;
  }

  static getState(state, reason) {
    if (state) {
      return '<p class="d-none state">Success</p><i class="fas fa-thumbs-up text-success fa-3x"></i>';
    } else {
      if (reason === "cancelled") {
        return '<p class="d-none state">Cancelled</p><i class="fas fa-thumbs-down text-warning fa-3x"></i>';
      } else {
        return '<p class="d-none state">Failure</p><i class="fas fa-exclamation text-danger fa-3x"></i>';
      }
    }
  }
}
HistoryClean.start();
module.exports = {
  HistoryClean,
};
