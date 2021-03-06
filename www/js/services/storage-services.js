angular.module('cesium.storage.services', ['ngResource', 'ngResource', 'ngApi', 'cesium.config'])

  .factory('localStorage', function($window, $q, $rootScope, $timeout, ionicReady, csConfig, Api) {
    'ngInject';

    var
      appName = "Cesium",
      api = new Api(this, "localStorage"),
      started = false,
      startPromise,
      isDevice = true, // default for device (override later)
      exports = {
        api: api,
        useHttpsFrame: false,
        standard: {
          storage: null
        },
        secure: {
          storage: null
        }
      };

    // removeIf(device)
    // Use this workaround to avoid to wait ionicReady() event
    isDevice = false;
    // endRemoveIf(device)

    /* -- Use standard browser implementation -- */

    exports.standard.put = function(key, value) {
      exports.standard.storage[key] = value;
      return $q.when();
    };

    exports.standard.get = function(key, defaultValue) {
      return $q.when(exports.standard.storage[key] || defaultValue);
    };

    exports.standard.setObject = function(key, value) {
      exports.standard.storage[key] = JSON.stringify(value);
      return $q.when();
    };

    exports.standard.getObject = function(key) {
      return $q.when(JSON.parse(exports.standard.storage[key] || '{}'));
    };

    /* -- Use secure storage (using a cordova plugin) -- */

    // Set a value to the secure storage (or remove if value is not defined)
    exports.secure.put = function(key, value) {
      var deferred = $q.defer();
      if (angular.isDefined(value)) {
        exports.secure.storage.set(
          function (key) { deferred.resolve(); },
          function (err) { deferred.reject(err); },
          key, value);
      }
      // Remove
      else {
        exports.secure.storage.remove(
          function (key) { deferred.resolve(); },
          function (err) { deferred.reject(err); },
          key);
      }
      return deferred.promise;
    };

    // Get a value from the secure storage
    exports.secure.get = function(key, defaultValue) {
      var deferred = $q.defer();
      exports.secure.storage.get(
        function (value) {
          if (!value && defaultValue) {
            deferred.resolve(defaultValue);
          }
          else {
            deferred.resolve(value);
          }
        },
        function (err) { deferred.reject(err); },
        key);
      return deferred.promise;
    };

    // Set a object to the secure storage
    exports.secure.setObject = function(key, value) {
      return exports.secure.set(key, JSON.stringify(value));
    };

    // Get a object from the secure storage
    exports.secure.getObject = function(key) {
      return exports.secure.get(key)
        .then(function(value) {
          return (value && JSON.parse(value)) || {};
        });
    };

    function initStandardStorage() {
      console.debug('[storage] Starting [standard mode]...');
      exports.standard.storage = $window.localStorage;
      // Set standard storage as default
      _.forEach(_.keys(exports.standard), function(key) {
        exports[key] = exports.standard[key];
      });

      return $q.when();
    }

    function initSecureStorage() {
      console.debug('[storage] Starting [secure mode]...');
      // Set secure storage as default
      _.forEach(_.keys(exports.secure), function(key) {
        exports[key] = exports.secure[key];
      });

      var deferred = $q.defer();

      ionicReady().then(function() {
        // No secure storage plugin: fall back to standard storage
        if (!cordova.plugins || !cordova.plugins.SecureStorage) {
          console.debug('[storage] No cordova plugin. Will use standard....');
          deferred.resolve(initStandardStorage());
          return;
        }
        exports.secure.storage = new cordova.plugins.SecureStorage(
          function () {
            deferred.resolve();
          },
          function (err) {
            console.error('[storage] Could not use secure storage. Will use standard.', err);
            deferred.resolve(initStandardStorage());
          },
          appName);
      });

      return deferred.promise;
    }

    exports.isStarted = function() {
      return started;
    };

    exports.ready = function() {
      if (started) return $q.when();
      return startPromise || start();
    };

    function start() {
      if (startPromise) return startPromise;

      var now = new Date().getTime();

      // Use Cordova secure storage plugin
      if (isDevice) {
        startPromise = initSecureStorage();
      }

      // Use default browser local storage
      else {
        startPromise = initStandardStorage();
      }

      return startPromise
        .then(function() {
          console.debug('[storage] Started in ' + (new Date().getTime() - now) + 'ms');
          started = true;
          startPromise = null;
        });
    }

    // default action
    start();

    return exports;
  })
;
