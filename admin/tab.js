function Messages(main) {
    var that = this;
    this.list = [];
    this.groups = [];
    // this.$dialogCron    = $('#dialog-cron');
    this.editor = null;
    this.changed = false;
    this.main = main;
    this.currentId = null;
    this.engines = [];
    this.instance = null;

    this.prepare = function () {
    };

    this.resize = function (width, height) {
        if (this.editor) this.editor.resize();
    };

    function getGroup(id) {
        var parts = id.split('.');
        parts.pop();
        return parts.join('.');
    }

    function fillGroups(elemName) {
        var groups = ['script.js', 'script.js.common', 'script.js.global'];

        for (var i = 0; i < that.list.length; i++) {
            var g = getGroup(that.list[i]);
            if (groups.indexOf(g) === -1) groups.push(g);
        }
        for (var j = 0; j < that.groups.length; j++) {
            if (groups.indexOf(that.groups[j]) === -1) groups.push(that.groups[j]);
        }
        var text = '';

        for (g = 0; g < groups.length; g++) {
            var name = groups[g].substring('script.js.'.length);
            if (name === 'global' || name === 'common') {
                name = _(name);
            }

            if (!name) name = _('no group');

            if (that.main.objects[groups[g]] && that.main.objects[groups[g]].common && that.main.objects[groups[g]].common.name) {
                name = that.main.objects[groups[g]].common.name;
            }

            text += '<option value="' + groups[g] + '">' + name + '</option>\n';
            // create group if not exists
            if (groups[g] !== 'script.js' && groups[g] !== 'script' && (!that.main.objects[groups[g]] || !that.main.objects[groups[g]].common)) {
                that.main.socket.emit('setObject', groups[g], {
                    common: {
                        name: groups[g].split('.').pop()
                    },
                    type: 'channel'
                }, function (err) {
                    if (err) {
                        that.main.showError(err);
                        that.init(true);
                    }
                });
            }
        }

        if (elemName) {
            var val = $('#' + elemName).val();
            $('#' + elemName).html(text).val(val);
        }
    }


    this.sendTo = function (message, payload, callback) {
        this.main.socket.emit('sendTo', this.main.instanceFullName, message, payload, function (response) {
            setTimeout(function () {
                if (response.error) {
                    // handle error
                    main.showError(response.error.message);
                    return;
                }
                callback && callback(response);
            }, 0);
        });
    };

    var gotResponse = 0;
    this.pingAdapter = function () {
        var callItself = function () {
            setTimeout(function () {
                that.pingAdapter();
            }, 1000);
        };

        setTimeout(function () {
            if (gotResponse === 0) {
                $('#connecting').show();
                callItself();
            }
            else {
                $('#connecting').hide();
            }
        }, 2000);
        gotResponse = 0;
        var that = this;
        this.main.socket.emit('sendTo', this.main.instanceFullName, 'ping', {}, function (response) {
            gotResponse = 1;
            callItself();
        });
    };

    this.currentPage = 1;
    this.getPage = function (page) {
        this.currentPage = page;
        var that = this;
        console.log('getting page: ' + page);
        this.sendTo('getMessages', {page: page}, function (response) {
            $('#log-table').html('');
            var size = response && response.value ? response.value.length : 0;
            for (var i = 0; i < size; i++) {
                that.add(response.value[i]);
            }
        });
    };

    this.init = function (update) {
        var that = this;
        if (!this.main.objectsLoaded) {
            setTimeout(function () {
                that.init(update);
            }, 250);
            return;
        }
        if (!this.instance) {
            this.instance = location.search.split('=')[1];
            this.main.instanceFullName = 'gp-msgs.' + this.instance;
        }

        this.pingAdapter();
        // $('#log-table').html('');
        this.sendTo('getMessageCount', {}, function (response) {
            var totalCount = response.value.totalCount;
            $('#log-size').html('Total count:' + ' ' + totalCount);
            paginationOptions.max_page = response.value.pageCount;
            paginationOptions.paged = function (page) {
                that.getPage(page);
            };
            createPagination(paginationOptions);
            // updatePagination('max_page', response.value.pageCount);
            that.getPage(1);
        });
    };

    this.add = function (message) {
        // if (this.logPauseMode) {
        //     this.logPauseList.push(message);
        //     this.logPauseCounter++;
        //
        //     if (this.logPauseCounter > this.logLimit) {
        //         if (!this.logPauseOverflow) {
        //             $('#log-pause').addClass('ui-state-error')
        //                 .attr('title', _('Message buffer overflow. Losing oldest'));
        //             this.logPauseOverflow = true;
        //         }
        //         this.logPauseList.shift();
        //     }
        //     this.logPauseCounterSpan.html(this.logPauseCounter);
        //     return;
        // }

        // //message = {message: msg, severity: level, from: this.namespace, ts: (new Date()).getTime()}
        // if (this.logLinesCount >= this.logLimit) {
        //     var line = document.getElementById('log-line-' + (this.logLinesStart + 1));
        //     if (line) line.outerHTML = '';
        //     this.logLinesStart++;
        // } else {
        //     this.logLinesCount++;
        // }

        // var $log_filter_host = $('#log-filter-host');
        // var hostFilter = $log_filter_host.val();
        //
        // if (message.from && this.logHosts.indexOf(message.from) == -1) {
        //     this.logHosts.push(message.from);
        //     this.logHosts.sort();
        //     $log_filter_host.html('<option value="">' + _('all') + '</option>');
        //     for (var i = 0; i < this.logHosts.length; i++) {
        //         $log_filter_host.append('<option value="' + this.logHosts[i].replace(/\./g, '-') + '" ' + ((this.logHosts[i] == hostFilter) ? 'selected' : '') + '>' + this.logHosts[i] + '</option>');
        //     }
        // }
        // var visible = '';
        //
        // if (hostFilter && hostFilter != message.from) visible = 'display: none';
        //
        // var sevFilter = $('#log-filter-severity').val();
        // if (!visible && sevFilter) {
        //     if (sevFilter == 'info' && message.severity == 'debug') {
        //         visible = 'display: none';
        //     } else if (sevFilter == 'warn' && message.severity != 'warn' && message.severity != 'error') {
        //         visible = 'display: none';
        //     } else if (sevFilter == 'error' && message.severity != 'error') {
        //         visible = 'display: none';
        //     }
        // }

        // if (message.severity == 'error') $('a[href="#tab-log"]').addClass('errorLog');

        // var text = '<tr id="log-line-' + (this.logLinesStart + this.logLinesCount) + '" class="log-line log-severity-' + message.severity + ' ' + (message.from ? 'log-from-' + message.from : '') + '" style="' + visible + '">';
        // text += '<td class="log-column-1">' + (message.from || '') + '</td>';
        // text += '<td class="log-column-2">' + this.main.formatDate(message.ts) + '</td>';
        // text += '<td class="log-column-3">' + message.severity + '</td>';
        // text += '<td class="log-column-4" title="' + message.message.replace(/"/g, "'") + '">' + message.message.substring(0, 200) + '</td></tr>';

        var text = '<tr id="log-line-' + message.ID + '" class="log-line">';
        // text += '<td class="log-column-1">' + message.ID + '</td>';
        text += '<td class="log-column-time">' + message.Coming.replace('T', ' ').replace('Z', '') + '</td>';
        text += '<td class="log-column-time">' + message.Going.replace('T', ' ').replace('Z', '') + '</td>';
        text += '<td class="log-column-duration">' + message.Duration + '</td>';
        text += '<td class="log-column-operand">' + message.Operand + '</td>';
        text += '<td class="log-column" title="' + message.Text.replace(/"/g, "'") + '">' + message.Text.substring(0, 200) + '</td>';
        text += '<td class="log-column-class log-severity-' + message.Class.toLocaleLowerCase() + '">' + message.Class + '</td></tr>';


        // $('#log-table').prepend(text);
        $('#log-table').append(text);
    };

    this.objectChange = function (id, obj) {

        return;

        // Update scripts
        if (id.match(/^script\./)) {
            if (obj) {
                if (this.list.indexOf(id) == -1) this.list.push(id);
            } else {
                // deleted
                var j = this.list.indexOf(id);
                if (j != -1) this.list.splice(j, 1);
            }

            if (this.updateTimer) clearTimeout(this.updateTimer);

            this.updateTimer = setTimeout(function () {
                that.updateTimer = null;
                that.$grid.selectId('reinit');
                applyResizableH(true, 1000);
            }, 200);

            if (this.$grid) this.$grid.selectId('object', id, obj);
        } else if (id.match(/^system\.adapter\.[-\w]+\.[0-9]+$/)) {
            var val = $('#edit-script-engine-type').val();
            that.engines = that.fillEngines('edit-script-engine-type');
            $('#edit-script-engine-type').val(val);
        }

        if (id.match(/^script\.js\./) && obj && obj.type === 'channel') {
            scripts.groups.push(id);
            if (!that.renaming) fillGroups('edit-script-group');
        }
    };

    function getTimeString(d) {
        var text = '';
        var i = d.getHours();
        if (i < 10) i = '0' + i.toString();
        text = i + ':';

        i = d.getMinutes();
        if (i < 10) i = '0' + i.toString();
        text += i + ':';
        i = d.getSeconds();
        if (i < 10) i = '0' + i.toString();
        text += i + '.';
        i = d.getMilliseconds();
        if (i < 10) {
            i = '00' + i.toString();
        } else if (i < 100) {
            i = '0' + i.toString();
        }
        text += i;
        return text;
    }

    this.onLog = function (message) {
        if (!this.$parentOutput) this.$parentOutput = $('#script-output').parent().parent();

        //{"message":"javascript.0 Stop script script.js.Script4","severity":"info","from":"javascript.0","ts":1455490697111,"_id":364}
        if (that.currentId && message.message.indexOf(that.currentId) !== -1) {
            var text = '<tr class="' + message.severity + '"><td>' + getTimeString(new Date(message.ts)) + '</td><td>[' + message.severity + ']</td><td>' + message.message + '</td></tr>';
            var h = this.$parentOutput.height();

            var oldHeight = $('#script-output').height();
            var scrollTop = this.$parentOutput.scrollTop();
            var shiftToEnd = (scrollTop + h >= oldHeight - 5);

            if (oldHeight > 2000) {
                $('#script-output tr:first').remove();
                var oldHeight1 = $('#script-output').height();
                this.$parentOutput.scrollTop(scrollTop - (oldHeight - oldHeight1));

                oldHeight = oldHeight1;
            }

            var scrollTop = this.$parentOutput.scrollTop();
            var shiftToEnd = (scrollTop + h >= oldHeight - 5);

            $('#script-output').append(text);

            if (shiftToEnd) {
                this.$parentOutput.scrollTop(oldHeight + 50);
            }
        }
    }

    this.clear = function () {
        // $('#log-table').html('');
        // setTimeout(function () {
        //     that.init();
        // }, 0);

        this.getPage(this.currentPage);

    };
}
var paginationOptions = {
    current_page: 1,
    page_string: '{current_page} / {max_page}'
};
var updatePagination = function (key, value) {
    $('.pagination').jqPagination('option', key, value)
};
var createPagination = function (options) {
    var html =
        '<a href="#" class="first" data-action="first">&laquo;</a>' +
        '<a href="#" class="previous" data-action="previous">&lsaquo;</a>' +
        '<input type="text" readonly="readonly" data-max-page="40"/>' +
        '<a href="#" class="next" data-action="next">&rsaquo;</a>' +
        '<a href="#" class="last" data-action="last">&raquo;</a>';

    $('.pagination').html('');
    $('.pagination').html(html);
    $('.pagination').jqPagination(options);
};

var main = {
    socket: io.connect(),
    saveConfig: function (attr, value) {
        if (!main.config) return;
        if (attr) main.config[attr] = value;

        if (typeof storage != 'undefined') {
            storage.set('adminConfig', JSON.stringify(main.config));
        }
    },
    showError: function (error) {
        main.showMessage(_(error), _('Error'), 'alert');
    },
    showMessage: function (message, title, icon) {

        // var $dialogMessage = $('#dialog-message');

        $dialogMessage.dialog('option', 'title', title || _('Message'));
        $('#dialog-message-text').html(message);
        if (icon) {
            $('#dialog-message-icon').show();
            $('#dialog-message-icon').attr('class', '');
            $('#dialog-message-icon').addClass('ui-icon ui-icon-' + icon);
        } else {
            $('#dialog-message-icon').hide();
        }
        $dialogMessage.dialog('open');
    },
    confirmMessage: function (message, title, icon, buttons, callback) {
        if (typeof buttons === 'function') {
            callback = buttons;
            $dialogConfirm.dialog('option', 'buttons', [
                {
                    text: _('Ok'),
                    click: function () {
                        var cb = $(this).data('callback');
                        $(this).dialog('close');
                        if (cb) cb(true);
                    }
                },
                {
                    text: _('Cancel'),
                    click: function () {
                        var cb = $(this).data('callback');
                        $(this).dialog('close');
                        if (cb) cb(false);
                    }
                }

            ]);
        } else if (typeof buttons === 'object') {
            for (var b = 0; b < buttons.length; b++) {
                buttons[b] = {
                    text: buttons[b],
                    id: 'dialog-confirm-button-' + b,
                    click: function (e) {
                        var id = parseInt(e.currentTarget.id.substring('dialog-confirm-button-'.length), 10);
                        var cb = $(this).data('callback');
                        $(this).dialog('close');
                        if (cb) cb(id);
                    }
                }
            }
            $dialogConfirm.dialog('option', 'buttons', buttons);
        }

        $dialogConfirm.dialog('option', 'title', title || _('Message'));
        $('#dialog-confirm-text').html(message);
        if (icon) {
            $('#dialog-confirm-icon').show();
            $('#dialog-confirm-icon').attr('class', '');
            $('#dialog-confirm-icon').addClass('ui-icon ui-icon-' + icon);
        } else {
            $('#dialog-confirm-icon').hide();
        }
        $dialogConfirm.data('callback', callback);
        $dialogConfirm.dialog('open');
    },
    initSelectId: function () {
        if (main.selectId) return main.selectId;
        main.selectId = $('#dialog-select-member').selectId('init', {
            objects: main.objects,
            states: main.states,
            noMultiselect: true,
            imgPath: '../../lib/css/fancytree/',
            filter: {type: 'state'},
            texts: {
                select: _('Select'),
                cancel: _('Cancel'),
                all: _('All'),
                id: _('ID'),
                name: _('Name'),
                role: _('Role'),
                room: _('Room'),
                value: _('Value'),
                selectid: _('Select ID'),
                from: _('From'),
                lc: _('Last changed'),
                ts: _('Time stamp'),
                wait: _('Processing...'),
                ack: _('Acknowledged')
            },
            columns: ['image', 'name', 'role', 'room', 'value']
        });
        return main.selectId;
    },
    objects: {},
    states: {},
    instanceFullName: '',
    instances: [],
    objectsLoaded: false,
    waitForRestart: false,
    selectId: null
};

var $dialogMessage = $('#dialog-message');
var $dialogConfirm = $('#dialog-confirm');

// Read all positions, selected widgets for every view,
// Selected view, selected menu page,
// Selected widget or view page
// Selected filter
if (typeof storage != 'undefined') {
    try {
        main.config = storage.get('adminConfig');
        if (main.config) {
            main.config = JSON.parse(main.config);
        } else {
            main.config = {};
        }
    } catch (e) {
        console.log('Cannot load edit dbConfig');
        main.config = {};
    }
}
var firstConnect = true;
var scripts = new Messages(main);

function getStates(callback) {
    main.socket.emit('getStates', function (err, res) {
        main.states = res;
        if (typeof callback === 'function') {
            setTimeout(function () {
                callback();
            }, 0);
        }
    });
}

function getObjects(callback) {
    main.socket.emit('getObjects', function (err, res) {
        setTimeout(function () {
            //     var obj;
            //     main.objects = res;
            //     for (var id in main.objects) {
            //         if (id.slice(0, 7) === '_design') continue;
            //
            //         obj = res[id];
            //         if (obj.type === 'instance') main.instances.push(id);
            //         if (obj.type === 'script')   scripts.list.push(id);
            //         if (obj.type === 'channel' && id.match(/^script\.js\./)) scripts.groups.push(id);
            //     }
            main.objectsLoaded = true;
            //
            //     scripts.prepare();
            scripts.init();
            //
            //     if (typeof callback === 'function') callback();


            // $('.pagination').jqPagination({
            //     // link_string	: '/?page={page_number}',
            //     max_page: 40,
            //     paged: function (page) {
            //         // $('.pagination input').val(page);
            //     }
            // });
            //
            // $('#wrap').scroll(function(){
            //     var translate = "translate(0,"+this.scrollTop+"px)";
            //     $('#wrap table').css('transform', translate);
            // });

            $('#log-refresh').button({icons: {primary: 'ui-icon-refresh'}, text: false}).click(function () {
                scripts.clear();
            }).css({width: 20, height: 20});

            $dialogMessage.dialog({
                autoOpen: false,
                modal: true,
                buttons: [
                    {
                        text: _('Ok'),
                        click: function () {
                            $(this).dialog("close");
                        }
                    }
                ]
            });

            $('#tabs').tabs();

        }, 0);
    });
}

function objectChange(id, obj) {
    // update main.objects cache
    if (obj) {
        if (obj._rev && main.objects[id]) main.objects[id]._rev = obj._rev;
        if (!main.objects[id] || JSON.stringify(main.objects[id]) != JSON.stringify(obj)) {
            main.objects[id] = obj;
        }
    } else if (main.objects[id]) {
        var oldObj = {_id: id, type: main.objects[id].type};
        delete main.objects[id];
        if (oldObj.type === 'instance') {
            var pos = main.instances.indexOf(id);
            if (pos !== -1) main.instances.splice(pos, 1);
        } else if (oldObj.type === 'script') {
            var pos = main.instances.indexOf(id);
            if (pos !== -1) main.instances.splice(pos, 1);
        } else if (id.match(/^script\.js\./) && oldObj.type === 'channel') {
            var pos = main.instances.indexOf(id);
            if (pos !== -1) main.instances.splice(pos, 1);
        }
    }

    if (main.selectId) main.selectId.selectId('object', id, obj);

    if (id.match(/^system\.adapter\.[-\w]+\.[0-9]+$/)) {
        // Disable scripts tab if no one script engine instance found
        var engines = scripts.fillEngines();
        $('#tabs').tabs('option', 'disabled', (engines && engines.length) ? [] : [4]);
    }

    scripts.objectChange(id, obj);
}

function stateChange(id, state) {

    if (main.instanceFullName && id && id.indexOf(main.instanceFullName) !== -1 && id.indexOf('pageChanged') !== -1) {
        console.log('Page change:' + JSON.stringify(state));
        if (state.val == scripts.currentPage) {
            scripts.getPage(scripts.currentPage);
        }
    }

    // var rowData;
    // id = id ? id.replace(/[\s'"]/g, '_') : '';
    //
    // if (!id || !id.match(/\.messagebox$/)) {
    //     if (main.selectId) main.selectId.selectId('state', id, state);
    // }
}

function onLog(message) {
    scripts.onLog(message);
}
main.socket.on('permissionError', function (err) {
    main.showMessage(_('Has no permission to %s %s %s', err.operation, err.type, (err.id || '')));
});
main.socket.on('objectChange', function (id, obj) {
    // setTimeout(objectChange, 0, id, obj);
});
main.socket.on('stateChange', function (id, obj) {
    setTimeout(stateChange, 0, id, obj);
});
main.socket.on('connect', function () {
    $('#connecting').hide();
    if (firstConnect) {
        firstConnect = false;

        main.socket.emit('getUserPermissions', function (err, acl) {
            main.acl = acl;
            // Read system configuration
            main.socket.emit('getObject', 'system.config', function (err, data) {
                main.systemConfig = data;
                if (!err && main.systemConfig && main.systemConfig.common) {
                    systemLang = main.systemConfig.common.language;
                } else {
                    systemLang = window.navigator.userLanguage || window.navigator.language;

                    if (systemLang !== 'en' && systemLang !== 'de' && systemLang !== 'ru') {
                        main.systemConfig.common.language = 'en';
                        systemLang = 'en';
                    }
                }

                // translateAll();

                getStates(getObjects);
            });
        });
    }
    if (main.waitForRestart) {
        location.reload();
    }
});
main.socket.on('disconnect', function () {
    $('#connecting').show();
});
main.socket.on('reconnect', function () {
    $('#connecting').hide();
    if (main.waitForRestart) {
        location.reload();
    }
});
main.socket.on('reauthenticate', function () {
    location.reload();
});
main.socket.on('log', function (message) {
    setTimeout(onLog, 0, message);
});

function applyResizableH(install, timeout) {
    if (timeout) {
        setTimeout(function () {
            applyResizableH(install);
        }, timeout);
    } else {
        if ($('#grid-scripts').hasClass('ui-resizable')) $('#grid-scripts').resizable('destroy');

        if (!install) return;

        var width = parseInt(main.config['script-editor-width'] || '30%', 10);

        $('#grid-scripts').width(width + '%').next().width(100 - width + '%');

        $('#grid-scripts').resizable({
            autoHide: false,
            handles: 'e',
            resize: function (e, ui) {
                var parent = ui.element.parent();
                var remainingSpace = parent.width() - ui.element.outerWidth(),
                    divTwo = ui.element.next(),
                    divTwoWidth = (remainingSpace - (divTwo.outerWidth() - divTwo.width())) / parent.width() * 100 + "%";
                divTwo.width(divTwoWidth);
            },
            stop: function (e, ui) {
                var parent = ui.element.parent();
                var width = ui.element.width() / parent.width() * 100 + '%';
                ui.element.css({
                    width: width
                });
                main.saveConfig('script-editor-width', width);
                if (scripts.editor) scripts.editor.resize();
            }
        });
    }
}

function applyResizableV() {
    var height = parseInt(main.config['script-editor-height'] || '80%', 10);
    $('#editor-scripts-textarea').height(height + '%').next().height(100 - height + '%');

    $('#editor-scripts-textarea').resizable({
        autoHide: false,
        handles: 's',
        resize: function (e, ui) {
            var parent = ui.element.parent();
            var remainingSpace = parent.height() - ui.element.outerHeight(),
                divTwo = ui.element.next(),
                divTwoWidth = (remainingSpace - (divTwo.outerHeight() - divTwo.height())) / parent.height() * 100 + "%";
            divTwo.height(divTwoWidth);
        },
        stop: function (e, ui) {
            var parent = ui.element.parent();
            var height = ui.element.height() / parent.height() * 100 + '%';
            ui.element.css({
                height: height
            });
            main.saveConfig('script-editor-height', height);
            if (scripts.editor) scripts.editor.resize();
        }
    });
}
