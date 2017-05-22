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

function traceError(error) {
    adapter.log.error(error.message);
}
var connectionPromise = q.defer();
function getConnection() {
    if (!sqlConnection) {
        sqlConnection = new sql.Connection(dbConfig, function (error) {
            if (error) {
                traceError(error);
                sqlConnection = null;
                connectionPromise = q.defer();
            }
            else {
                connectionPromise.resolve(sqlConnection);
            }
        })
    }

    return connectionPromise.promise;
}

function executeQuery(query, retry) {
    var got = q.defer();

    var handleError = function (err) {
        if (!retry) {
            setTimeout(function () {
                executeQuery(query, true);
            }, 500);
        }
        got.reject(err);
    };

    //
    // sql
    //     .connect(dbConfig)
    getConnection()
        .then(function () {
                new sql
                    // .Request()
                    .Request(sqlConnection)
                    .query(query)
                    .then(function (reply) {
                        got.resolve(reply);
                    })
                    .catch(function (err) {
                        // ... error checks
                        handleError(err);
                    });
            }
        )
        .fail(function (err) {
            // ... error checks
            handleError(err);
        })
        .catch(function (err) {
            // ... error checks
            handleError(err);
        });

    return got.promise;
}

var messageClassConfig = [];
function getMessageClassConfig() {
    executeQuery('select * from AL_CLASSES')
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

function enrichItemsWithColors(recordset) {
    recordset.forEach(function (item) {
            var classConfig = getClassConfigForItem(item);
            if (classConfig) {
                if (item.Going) {
                    item.bc = classConfig.BC_ENDED;
                    item.fc = classConfig.FC_ENDED;
                } else if (item.TIME_RECOGNITION) {
                    item.bc = classConfig.BC_RECOGNIZED;
                    item.fc = classConfig.FC_RECOGNIZED;
                } else if (item.TIME_QUITTING) {
                    item.bc = classConfig.BC_QUITTED;
                    item.fc = classConfig.FC_QUITTED;
                } else {
                    item.bc = classConfig.BC_STARTED;
                    item.fc = classConfig.FC_STARTED;
                }
            }
        }
    );

    return recordset;
}

function enableDbChangeTracking() {
    var got = q.defer();

    var errorHandler = function (error) {
        var message = 'Error enabling change tracking for database [' + dbConfig.database + ']. Check DB permissions for configured user. ';
        adapter.log.error(message + error.message);
        got.reject(new Error(message));
    };

    executeQuery("SELECT * FROM sys.change_tracking_databases WHERE database_id=DB_ID('" + dbConfig.database + "')")
        .then(function (reply) {
            if (reply && Array.isArray(reply) && reply.length > 0) {
                return q.fcall(function () {
                    return 0;
                });
            }
            else {
                return executeQuery('ALTER DATABASE ' + dbConfig.database + ' SET CHANGE_TRACKING = ON');
            }
        })
        .then(function () {
            got.resolve();
        })
        .fail(function (error) {
            // ... error checks
            errorHandler(error);
        })
        .catch(function (error) {
            // ... error checks
            errorHandler(error);
        });

    return got.promise;
}

function enableTableChangeTracking(table) {
    var got = q.defer();

    var errorHandler = function (error) {
        var message = 'Error enabling change tracking for table [' + table + ']. Check DB permissions for configured user. ';
        adapter.log.error(message + error.message);
        got.reject(new Error(message));
    };

    executeQuery('select sys.schemas.name as Schema_name, sys.tables.name as Table_name from sys.change_tracking_tables ' +
        'join sys.tables on sys.tables.object_id = sys.change_tracking_tables.object_id ' +
        'join sys.schemas on sys.schemas.schema_id = sys.tables.schema_id')
        .then(function (reply) {
            var enabled = false;
            if (reply && Array.isArray(reply) && reply.length > 0) {
                enabled = reply.filter(function (row) {
                        return row['Table_name'] == table.replace('[', '').replace(']', '');
                    }).length > 0;
            }

            if (enabled) {
                return q.fcall(function () {
                    return 0;
                });
            }
            else {
                return executeQuery('ALTER TABLE ' + table + ' ENABLE CHANGE_TRACKING');
            }
        })
        .then(function () {
            got.resolve();
        })
        .fail(function (error) {
            // ... error checks
            errorHandler(error);
        })
        .catch(function (error) {
            // ... error checks
            errorHandler(error);
        });

    return got.promise;
}

function getLastMessagesVersion() {
    var got = q.defer();

    var errorHandler = function (error) {
        adapter.log.error('Error getting table last version. ' + error.message);
        got.reject(new Error('unable to get last change version. check DB permissions for configured user'));
    };

    executeQuery('select CHANGE_TRACKING_CURRENT_VERSION() as version')
        .then(function (reply) {
            lastMessagesVersion = reply[0].version;
            got.resolve();
        })
        .fail(function (error) {
            // ... error checks
            errorHandler(error);
        })
        .catch(function (error) {
            // ... error checks
            errorHandler(error);
        });

    return got.promise;
}
var getTableChangesRetryCount = 0;
var maxGetTableChangesRetryCount = 10;
function getTableChanges() {
    var pollTime = 500;
    if (lastMessagesVersion == -1) {
        adapter.log.error('Stop observing changes due to unknown last change version.');
        return;
    }
    var got = function (error) {
        if (error) {
            adapter.log.error('Error getting table changes. ' + error.message);
            getTableChangesRetryCount++;
        }

        if (getTableChangesRetryCount < maxGetTableChangesRetryCount) {
            //adapter.log.info('Next try to get table changes in ' + pollTime + 'ms');
            setTimeout(getTableChanges, pollTime);
        }
    };

    var query =
        'WITH rownumbers AS (SELECT ID, ROW_NUMBER() OVER(ORDER BY ID) AS RowNo FROM ' + ARCHIVE_TABLE + ')' +
        'select * from CHANGETABLE (CHANGES ' + ARCHIVE_TABLE + ',' + lastMessagesVersion + ') xx ' +
        'left outer join rownumbers rn on rn.[ID]=xx.[ID]';

    executeQuery(query, true)
        .then(function (reply) {
            getTableChangesRetryCount = 0;
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

                // var totalChanged = reply.filter(function (item) {
                //         return item.SYS_CHANGE_OPERATION != 'U';
                //     }).length > 0;
                //
                // if (totalChanged) {
                //     adapter.setState('totalChanged', lastMessagesVersion);
                // }

                adapter.setState('totalChanged', lastMessagesVersion);

            }
            got();
        })
        .fail(function (error) {
            got(error);
        })
        .catch(function (error) {
            got(error);
        });
}

function startObserving() {
    enableDbChangeTracking()
        .then(function () {
            return enableTableChangeTracking(ARCHIVE_TABLE);
        })
        .then(function () {
            return getLastMessagesVersion();
        })
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
    // executeQuery('select count(*) as recordCount from ' + ARCHIVE_TABLE)

    executeQuery('SELECT count(*) as recordCount from (select * from AL_ARCHIVE_EXT WHERE PENDING_IDX IS NOT NULL AND SHOWACT = 1) xx')
        .then(function (reply) {
            var remainder = reply[0].recordCount % pageSize;
            var pageCount = Math.floor(reply[0].recordCount / pageSize) + (remainder > 0 ? 1 : 0);
            got.resolve({
                totalCount: reply[0].recordCount,
                pageCount: pageCount
            });
        })
        .fail(function (err) {
            // ... error checks
            got.reject(err);
        })
        .catch(function (err) {
            // ... error checks
            got.reject(err);
        });
    return got.promise;
}

function getMessages(message) {
    var page = message.page || 1;
    var table = ARCHIVE_VIEW;
    var skip = (page - 1) * pageSize;

    // var query = 'select top ' + pageSize + ' * from ' +
    //     '(select t.[ID], [TIME_START] as [Coming], [TIME_END] as [Going], ' +
    //     'CONVERT(varchar, DATEADD(s, [DURATION_BRUTTO], 0), 108) as [Duration], ' +
    //     '[OPERAND] as [Operand], [TEXT_0] as [Text], ac.NAME_0 as [Class], ' +
    //     'AL_CLASS, TIME_QUITTING, TIME_RECOGNITION, ROW_NUMBER() over (order by t.[ID]) as r_n_n FROM '
    //     + table + ' t left outer join [AL_CLASSES] ac on ac.[ID]=t.[AL_CLASS]) xx where r_n_n >' + skip + ' order by ID';

    var query = 'select top ' + pageSize + ' * from ' +
        '(select t.[ID], [TIME_START] as [Coming], [TIME_END] as [Going],' +
        'ag.NAME_0 as [Group], ' +
        '[OPERAND] as [Operand], [TEXT_0] as [Text], ac.NAME_0 as [Class], ' +
        'AL_CLASS, AL_GROUP, TIME_QUITTING, TIME_RECOGNITION, SHOWACT, PENDING_IDX, ROW_NUMBER() over (order by t.[ID]) as r_n_n FROM ' + table + ' t ' +
        'left outer join [AL_CLASSES] ac on ac.[ID] = t.[AL_CLASS] ' +
        'left outer join [AL_GROUPS] ag on ag.[ID] = t.AL_GROUP ) xx ' +
        'where r_n_n >' + skip + ' AND PENDING_IDX IS NOT NULL AND SHOWACT = 1 order by ID';

    var got = q.defer();
    executeQuery(query)
        .then(function (recordset) {
                // assign colors to messages
                if (messageClassConfig.length) {

                    enrichItemsWithColors(recordset);

                    // recordset.forEach(function (item) {
                    //         var classConfig = getClassConfigForItem(item);
                    //         if (classConfig) {
                    //             if (item.TIME_RECOGNITION) {
                    //                 item.bc = classConfig.BC_RECOGNIZED;
                    //                 item.fc = classConfig.FC_RECOGNIZED;
                    //             } else if (item.TIME_QUITTING) {
                    //                 item.bc = classConfig.BC_QUITTED;
                    //                 item.fc = classConfig.FC_QUITTED;
                    //             } else if (item.Going) {
                    //                 item.bc = classConfig.BC_ENDED;
                    //                 item.fc = classConfig.FC_ENDED;
                    //
                    //             } else {
                    //                 item.bc = classConfig.BC_STARTED;
                    //                 item.fc = classConfig.FC_STARTED;
                    //             }
                    //         }
                    //     }
                    // );
                }
                got.resolve(recordset);
            }
        )
        .fail(function (err) {
            // ... error checks
            got.reject(err);
        })
        .catch(function (err) {
            // ... error checks
            got.reject(err);
        });


    return got.promise;
}


function getArchiveMessages(message) {
    var query = 'select * from '
        + '(select top 1000 t.[ID], [TIME_START] as [Coming], [TIME_END] as [Going], ' +
        'CONVERT(varchar, DATEADD(s, [DURATION_BRUTTO], 0), 108) as [Duration], ' +
        '[OPERAND] as [Operand], [TEXT_0] as [Text], ac.NAME_0 as [Class], ac.BC_ARCHIVED as bc, ac.FC_ARCHIVED as fc, ' +
        'AL_CLASS, TIME_QUITTING, TIME_RECOGNITION FROM AL_ARCHIVE_EXT t ' +
        'left outer join [AL_CLASSES] ac on ac.[ID]=t.[AL_CLASS]' +
        'WHERE ARCHIVE_IDX > 0 order by t.[ID] desc) xx ' +
        'ORDER BY [ID]';

    var got = q.defer();
    executeQuery(query)
        .then(function (recordset) {
                // assign colors to messages
                if (messageClassConfig.length) {
                    enrichItemsWithColors(recordset);
                }
                got.resolve(recordset);
            }
        )
        .fail(function (err) {
            // ... error checks
            got.reject(err);
        })
        .catch(function (err) {
            // ... error checks
            got.reject(err);
        });


    return got.promise;
}

function getProtocol(message) {
    var top = message.top || 1000;

    var query = 'SELECT top ' + top +
        '[ID], [TIME_ID] as Time ,[AL_ACTION] as Action, [SOURCE] as Source, [HANDLED_IDX] as Handled, [AL_GROUP] as [Group],' +
        '[OPERAND] as Operand, [ARCHIVE_ID] as ArchId, [ARV_ARCHIVE_ID] as ChangedArchId, [ARV_AL_CLASS] as Class' +
        ',[EXT_DEF] as ExtProperty,[ERROR_MESSAGE] as Text FROM [AL_PROTOCOL] order by ID desc';

    var got = q.defer();
    executeQuery(query)
        .then(function (recordset) {
                got.resolve(recordset);
            }
        )
        .fail(function (err) {
            // ... error checks
            got.reject(err);
        })
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
        case 'getArchiveMessages':
            fn = getArchiveMessages;
            break;
        case 'getMessageCount':
            fn = getMessageCount;
            break;
        case 'getProtocol':
            fn = getProtocol;
            break;
    }

    if (fn) {
        response(msg, fn);
    }

    // commons.sendResponse(adapter, msg, options, [], startTime);
}


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
    adapter.setObject('totalChanged', {
        type: 'state',
        common: {
            name: 'totalChanged',
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

process.on('uncaughtException', function (err) {
    console.error(err.stack);
    // process.exit();
});