/**
 *
 * gp-msgs adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "gp-msgs",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.0",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Node.js gp-msgs Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "name <mail@gp-msgs.com>"
 *          ]
 *          "desc":         "gp-msgs adapter",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.gp-msgs.0
var adapter = utils.adapter('gp-msgs');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // // you can use the ack flag to detect if it is status (true) or command (false)
    // if (state && !state.ack) {
    //     adapter.log.info('ack is not set!');
    // }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        processMessage(obj);
        // if (obj.command == 'send') {
        //     // e.g. send email or pushover or whatever
        //     console.log('send command');
        //
        //     // Send response in callback if required
        //     if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        // }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});


var sql = require('mssql');

var schema = require(__dirname + '/schema');
var q = require('q');
var ARCHIVE_TABLE = '[AL_ARCHIVE]';
var ARCHIVE_VIEW = '[AL_ARCHIVE_EXT]';
var sqlConnection;
process.on('SIGINT', function () {
    cleanup();
});

function cleanup() {
    if (sqlConnection) {
        sqlConnection.close();
    }
}

var dbConfig = {
    user: 'iobroker',
    password: 'iobroker',
    server: 'DR-GEFASOFT\\GRAPHPIC', // You can use 'localhost\\instance' to connect to named instance
    port: 1433,
    database: 'GP8'
};
var lastMessagesVersion = -1;

function executeQuery(query) {
    var got = q.defer();
    sql
        .connect(dbConfig)
        .then(function () {
                new sql
                    .Request()
                    .query(query)
                    .then(function (reply) {
                        got.resolve(reply);
                    })
                    .catch(function (err) {
                        // ... error checks
                        got.reject(err);
                    });
            }
        )
        .catch(function (err) {
            // ... error checks
            got.reject(err);
        });

    return got.promise;
}

var messageClassConfig = [];
function getMessageClassConfig() {
    var queryString = 'select * from AL_CLASSES';
    executeQuery(queryString)
        .then(function (reply) {
            messageClassConfig = reply;
        })
        .fail(function (error) {
            adapter.log.error('Error getting message class config. ' + error.message);
        })
        .catch(function (error) {
            adapter.log.error('Error getting message class config. ' + error.message);
        })
}

function getClassConfigForItem(item) {
    if (messageClassConfig.length) {
        return messageClassConfig.filter(function (cfg) {
            return cfg.ID === item.AL_CLASS;
        })[0];
    }

    return null;
}
var lastVersionGetterCount = 0;
function getLastMessagesVersion() {
    var got = q.defer();

    var finishedHandler = function (err) {
        if (err) {
            adapter.log.error('Error getting table last version. ' + err.message);
        }

        lastVersionGetterCount++;
        if (lastVersionGetterCount < 5) {
            setTimeout(getLastMessagesVersion, 1000);
        }
        else {
            adapter.log.error('Stopped trying to get table last version.');
            got.reject(new Error('unable to get last change version. check DB permissions for configured user'));
        }
    };

    sql
        .connect(dbConfig)
        .then(function () {
                new sql
                    .Request()
                    .query('select CHANGE_TRACKING_CURRENT_VERSION() as version')
                    .then(function (reply) {
                        lastMessagesVersion = reply[0].version;
                        got.resolve();
                    })
                    .catch(function (err) {
                        // ... error checks
                        finishedHandler(err);
                    });
            }
        )
        .catch(function (err) {
            // ... error checks
            finishedHandler(err);
        });
    return got.promise;
}

function getTableChanges() {
    var pollTime = 500;
    if (lastMessagesVersion == -1) return;
    var got = function (err) {
        if (err) {
            adapter.log.error('Error getting table changes. ' + err.message);
        }
        setTimeout(getTableChanges, pollTime);
    };

    var query =
        'WITH rownumbers AS (SELECT ID, ROW_NUMBER() OVER(ORDER BY ID) AS RowNo FROM ' + ARCHIVE_TABLE + ')' +
        'select * from CHANGETABLE (CHANGES ' + ARCHIVE_TABLE + ',' + lastMessagesVersion + ') xx ' +
        'left outer join rownumbers rn on rn.[ID]=xx.[ID]';

    sql
        .connect(dbConfig)
        .then(function () {
                new sql
                    .Request()
                    .query(query)
                    .then(function (reply) {
                        if (Array.isArray(reply) && reply.length > 0) {
                            // changes detected
                            lastMessagesVersion = Math.max.apply(Math, reply.map(function (item) {
                                return item.SYS_CHANGE_VERSION;
                            }));
                            var changedPages = reply.map(function (item) {
                                return Math.floor((parseInt(item.RowNo) + pageSize - 1) / pageSize);
                            });
                            changedPages.forEach(function (page) {
                                adapter.setState('pageChanged', page);
                            });
                        }
                        got();
                    })
                    .catch(function (err) {
                        got(err);
                    });
            }
        )
        .catch(function (err) {
            // ... error checks
            got(err);
        });
}

function startObserving() {
    getLastMessagesVersion()
        .then(function () {
            getTableChanges();
        })
        .fail(function (error) {
            adapter.log.error(error.message);
        })
        .catch(function (error) {
            adapter.log.error(error.message);
        });
}

function getMessageCount() {
    var got = q.defer();
    sql
        .connect(dbConfig)
        .then(function () {
                new sql
                    .Request()
                    .query('select count(*) as recordCount from ' + ARCHIVE_TABLE)
                    .then(function (reply) {

                        var remainder = reply[0].recordCount % pageSize;
                        var pageCount = Math.floor(reply[0].recordCount / pageSize) + (remainder > 0 ? 1 : 0);

                        got.resolve({
                            totalCount: reply[0].recordCount,
                            pageCount: pageCount
                        });
                    })
                    .catch(function (err) {
                        // ... error checks
                        got.reject(err);
                    });
            }
        )
        .catch(function (err) {
            // ... error checks
            got.reject(err);
        });

    return got.promise;
}

var lastState = true;
function getMessages(message) {

    adapter.setState('testVariable', lastState);
    lastState = !lastState;
    var page = message.page || 1;
    var table = ARCHIVE_VIEW;

    var query = 'select top ' + pageSize + ' * from ' +
        '(select t.[ID], [TIME_START] as [Coming], [TIME_END] as [Going], ' +
        'CONVERT(varchar, DATEADD(ms, [DURATION_BRUTTO] * 1000, 0), 108) as [Duration], ' +
        '[OPERAND] as [Operand], [TEXT_0] as [Text], ac.NAME_0 as [Class], ' +
        'AL_CLASS, TIME_QUITTING, TIME_RECOGNITION, ROW_NUMBER() over (order by t.[ID]) as r_n_n FROM '
        + table + ' t left outer join [GP8].[dbo].[AL_CLASSES] ac on ac.[ID]=t.[AL_CLASS]) xx where r_n_n > @skip order by ID';

    var skip = (page - 1) * pageSize;
    var got = q.defer();
    sql
        .connect(dbConfig)
        .then(function () {
                new sql
                    .Request()
                    .input('skip', sql.Int, skip)
                    .query(query)
                    .then(function (recordset) {

                            // assign colors to messages
                            if (messageClassConfig.length) {
                                recordset.forEach(function (item) {
                                        var classConfig = getClassConfigForItem(item);
                                        if (item.TIME_RECOGNITION) {
                                            item.bc = classConfig.BC_RECOGNIZED;
                                            item.fc = classConfig.FC_RECOGNIZED;
                                        } else if (item.TIME_QUITTING) {
                                            item.bc = classConfig.BC_QUITTED;
                                            item.fc = classConfig.FC_QUITTED;
                                        } else if (item.Going) {
                                            item.bc = classConfig.BC_ENDED;
                                            item.fc = classConfig.FC_ENDED;

                                        } else {
                                            item.bc = classConfig.BC_STARTED;
                                            item.fc = classConfig.FC_STARTED;
                                        }
                                    }
                                );
                            }

                            got.resolve(recordset);
                        }
                    )
                    .catch(function (err) {
                        // ... error checks
                        got.reject(err);
                    });
            }
        )
        .catch(function (err) {
            // ... error checks
            got.reject(err);
        });

    return got.promise;
}

function pong() {
    var got = q.defer();
    got.resolve();
    return got.promise;
}

var pageSize = 100;

function response(msg, fn) {
    // fn.apply(null, Array.prototype.slice.call(arguments, 2))
    fn.apply(null, [msg.message])
        .then(function (reply) {
            adapter.sendTo(msg.from, msg.command, {value: reply}, msg.callback);
        })
        .catch(function (error) {
            adapter.sendTo(msg.from, msg.command, {value: null, error: error}, msg.callback);
        });
}

function processMessage(msg) {
    if (!msg.callback) {
        return;
    }

    var fn = null;
    switch (msg.command) {
        case 'ping':
            fn = pong;
            break;
        case 'getMessages':
            fn = getMessages;
            break;
        case 'getMessageCount':
            fn = getMessageCount;
            break;
    }

    if (fn) {
        response(msg, fn);
    }

    // commons.sendResponse(adapter, msg, options, [], startTime);
}


// function sendResponse(adapter, msg, options, data, startTime) {
//     var aggregateData;
//     if (typeof data === 'string') {
//         adapter.log.error(data);
//         return adapter.sendTo(msg.from, msg.command, {
//             result:     [],
//             step:       0,
//             error:      data,
//             sessionId:  options.sessionId
//         }, msg.callback);
//     }
//
//     if (options.count && !options.start && data.length > options.count) {
//         data.splice(0, data.length - options.count);
//     }
//     if (data[0]) {
//         options.start = options.start || data[0].ts;
//
//         if (!options.aggregate || options.aggregate === 'onchange' || options.aggregate === 'none') {
//             aggregateData = {result: data, step: 0, sourceLength: data.length};
//
//             // convert ack from 0/1 to false/true
//             if (options.ack && aggregateData.result) {
//                 for (var i = 0; i < aggregateData.result.length; i++) {
//                     aggregateData.result[i].ack = !!aggregateData.result[i].ack;
//                 }
//             }
//             options.result = aggregateData.result;
//             beautify(options);
//         } else {
//             initAggregate(options);
//             aggregateData = aggregation(options, data);
//             finishAggregation(options);
//         }
//
//         adapter.log.info('Send: ' + aggregateData.result.length + ' of: ' + aggregateData.sourceLength + ' in: ' + (new Date().getTime() - startTime) + 'ms');
//         adapter.sendTo(msg.from, msg.command, {
//             result: aggregateData.result,
//             step:   aggregateData.step,
//             error:      null,
//             sessionId:  options.sessionId
//         }, msg.callback);
//     } else {
//         adapter.log.info('No Data');
//         adapter.sendTo(msg.from, msg.command, {result: [], step: null, error: null, sessionId: options.sessionId}, msg.callback);
//     }
// }

function main() {

    // The adapters dbConfig (in the instance object everything under the attribute "native") is accessible via
    // adapter.dbConfig:
    // adapter.log.info('dbConfig test1: ' + adapter.dbConfig.test1);
    // adapter.log.info('dbConfig test1: ' + adapter.dbConfig.test2);


    /**
     *
     *      For every state in the system there has to be also an object of type state
     *
     *      Here a simple gp-msgs for a boolean variable named "testVariable"
     *
     *      Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
     *
     */
    //
    // adapter.setObject('testVariable', {
    //     type: 'state',
    //     common: {
    //         name: 'testVariable',
    //         type: 'boolean',
    //         role: 'indicator'
    //     },
    //     native: {}
    // });

    adapter.setObject('pageChanged', {
        type: 'state',
        common: {
            name: 'pageChanged',
            type: 'int',
            role: 'indicator'
        },
        native: {}
    });

    // in this gp-msgs all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');


    /**
     *   setState examples
     *
     *   you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
     *
     */

    // the variable testVariable is set to true as command (ack=false)
    // adapter.setState('testVariable', true);

    // same thing, but the value is flagged "ack"
    // ack should be always set to true if the value is received from or acknowledged from the target system
    // adapter.setState('testVariable', {val: true, ack: true});

    // same thing, but the state is deleted after 30s (getState will return null afterwards)
    // adapter.setState('testVariable', {val: true, ack: true, expire: 30});


    // examples for the checkPassword/checkGroup functions
    adapter.checkPassword('admin', 'iobroker', function (res) {
        console.log('check user admin pw ioboker: ' + res);
    });

    adapter.checkGroup('admin', 'admin', function (res) {
        console.log('check group user admin group admin: ' + res);
    });


    dbConfig.user = adapter.config.user;
    dbConfig.password = adapter.config.password;
    dbConfig.server = adapter.config.server + (adapter.config.instance ? '\\' + adapter.config.instance : '');
    // dbConfig.server = '127.0.0.1' + (adapter.config.instance ? '\\\\' + adapter.config.instance : '');
    dbConfig.port = adapter.config.port;
    dbConfig.database = adapter.config.database;

    schema.setConfig(dbConfig);

     getMessageClassConfig();
    startObserving();
}
