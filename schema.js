var sql = require('mssql');
var q = require('q');

var dbConfig = {
    user: 'iobroker',
    password: 'iobroker',
    server: 'DR-GEFASOFT\\GRAPHPIC', // You can use 'localhost\\instance' to connect to named instance
    port: 1433,
    database: 'GP8'
};
var setConfig = function (config) {
    dbConfig = config;
};

var getMessages = function (message) {
    var page = message.page || 1;
    var table = message.table == 'actual' ? '[GP8].[dbo].[AL_MESSAGES]' : '[GP8].[dbo].[AL_ARCHIVE]';
    var skip = (page - 1) * pageSize;
    var got = q.defer();
    sql
        .connect(dbConfig)
        .then(function () {
                new sql
                    .Request()
                    .input('skip', sql.Int, skip)
                    .query('select top ' + pageSize + ' * from ' +
                        // '(select ID, TIME_START, TIME_END, TEXT_0, AL_CLASS, AL_TYPE, ROW_NUMBER() over (order by ID) as r_n_n from AL_MESSAGES) xx where r_n_n > @skip order by ID'
                        '(select t.[ID], [TIME_START] as [Coming], [TIME_END] as [Going], CONVERT(varchar, DATEADD(ms, [DURATION_BRUTTO] * 1000, 0), 108) as [Duration], [OPERAND] as [Operand], [TEXT_0] as [Text], ac.NAME_0 as [Class], ROW_NUMBER() over (order by t.[ID]) as r_n_n FROM ' + table + ' t left outer join  [GP8].[dbo].[AL_CLASSES] ac on ac.[ID]=t.[AL_CLASS]) xx where r_n_n > @skip order by ID'
                    )
                    .then(function (recordset) {
                        got.resolve(recordset);
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
};

var getMessageCount = function () {

    var got = q.defer();
    sql
        .connect(dbConfig)
        .then(function () {
                new sql
                    .Request()
                    .query('select count(*) as recordCount from AL_MESSAGES')
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
};

module.exports = {
    setConfig: setConfig,
    getMessages: getMessages,
    getMessageCount: getMessageCount
};