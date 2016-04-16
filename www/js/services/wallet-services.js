//var Base58, Base64, scrypt_module_factory = null, nacl_factory = null;

angular.module('cesium.wallet.services', ['ngResource', 'cesium.bma.services', 'cesium.crypto.services', 'cesium.registry.services'])

.factory('Wallet', ['$q', 'CryptoUtils', 'BMA', 'Registry', function($q, CryptoUtils, BMA, Registry) {

  Wallet = function(id) {

    var

    USE_RELATIVE_DEFAULT = true,

    data = {
        pubkey: null,
        keypair: {
            signSk: null,
            signPk: null
        },
        balance: 0,
        sources: null,
        useRelative: USE_RELATIVE_DEFAULT,
        currency: null,
        currentUD: null,
        medianTime: null,
        history: {},
        requirements: {},
        loaded: false,
        blockUid: null,
        sigQty: null,
        avatar: null
    },

    resetData = function() {
      data.pubkey= null;
      data.keypair ={
                signSk: null,
                signPk: null
            };
      data.balance = 0;
      data.sources = null;
      data.useRelative = USE_RELATIVE_DEFAULT;
      data.currency= null;
      data.currentUD= null;
      data.medianTime = null;
      data.history= {};
      data.requirements= {};
      data.loaded= false;
      data.blockUid= null;
      data.sigQty = null;
      data.avatar = null;
    },

    reduceTxAndPush = function(txArray, result) {
      if (!txArray || txArray.length === 0) {
        return;
      }
      txArray.forEach(function(tx) {
        var walletIsIssuer = false;
        var otherIssuer = tx.issuers.reduce(function(issuer, res, index) {
            walletIsIssuer = (res === data.pubkey) ? true : walletIsIssuer;
            return issuer + ((res !== data.pubkey) ? ', ' + res : '');
        }, ', ').substring(2);
        var otherReceiver = (!walletIsIssuer) ? data.pubkey : '';
        /*var amount = tx.inputs.reduce(function(sum, output) {
            if (!!data.sources[output]) {
              if (!data.sources[output].consumed) {
                data.sources[output].consumed=true;
              }
              return sum - data.sources[output].amount;
            }
            return sum;
          }, 0);*/
        var amount = tx.outputs.reduce(function(sum, output) {
            var outputArray = output.split(':',3);
            var outputAmount = parseInt(outputArray[0]);
            var outputCondArray = outputArray[2].split('(', 3);
            var outputPubkey = (outputCondArray.length == 2 && outputCondArray[0] == 'SIG') ?
                 outputCondArray[1].substring(0,outputCondArray[1].length-1) : '';
            if (outputPubkey == data.pubkey) { // output is for the wallet
              if (!walletIsIssuer) {
                return sum + outputAmount;
              }
            }
            else { // output is for someone else
              if (outputPubkey !== '') {
                otherReceiver = outputPubkey;
              }
              if (walletIsIssuer) {
                return sum - outputAmount;
              }
            }
            return sum;
          }, 0);

        var time = tx.time;
        if (!time) {
          time= Math.floor(moment().utc().valueOf() / 1000);
        }

        result.push({
          time: time,
          amount: amount,
          issuer: otherIssuer,
          receiver: otherReceiver,
          comment: tx.comment,
          isUD: false,
          hash: tx.hash,
          locktime: tx.locktime,
          block_number: tx.block_number
        });
      });
    },

    login = function(salt, password) {
        return $q(function(resolve, reject) {
            CryptoUtils.connect(salt, password).then(
                function(keypair) {
                    // Copy result to properties
                    data.pubkey = CryptoUtils.util.encode_base58(keypair.signPk);
                    data.keypair = keypair;
                    resolve(data);
                }
            );
        });
    },

    logout = function(username, password) {
        return $q(function(resolve, reject) {
            resetData();
            resolve();
        });
    },

    isLogin = function() {
        return !!data.pubkey;
    },

    getData = function() {
      return data;
    },

    isSourceEquals = function(arg1, arg2) {
        return arg1.type == arg2.type &&
            arg1.fingerprint == arg2.fingerprint &&
            arg1.number == arg2.number &&
            arg1.amount == arg2.amount;
    },

    loadRequirements = function() {
      return $q(function(resolve, reject) {
        // Get requirements
        BMA.wot.requirements({pubkey: data.pubkey})
        .then(function(res){
          if (!res.identities && res.identities.length != 1) {
            data.requirements = null;
            data.blockUid = null;
            resolve();
            return;
          }
          var idty = res.identities[0];
          data.requirements = idty;
          data.uid = idty.uid;
          data.blockUid = idty.meta.timestamp;
          // TODO
          //data.requirements.needCertifications = (idty.certifications.length < data.sigQty);
          resolve();
        })
        .catch(function(err) {
          data.requirements = {};
          data.blockUid = null;
          // If identity not publiched : continue
          if (!!err && err.ucode == 2004) {
            resolve();
          }
          else {
            reject(err);
          }
        });
      });
    },

    loadSources = function(refresh) {
      return $q(function(resolve, reject) {
        // Get transactions
        BMA.tx.sources({pubkey: data.pubkey})
        .then(function(res){
          if (!data.sources) {
            data.sources=[];
          }
          var sources = [];
          var balance = 0;
          if (!!res.sources && res.sources.length > 0) {
            res.sources.forEach(function(src) {
              var srcKey = src.type+':'+src.identifier+':'+src.noffset;
              if (!!data.sources[srcKey]) {
                src.consumed = data.sources[srcKey].consumed;
              }
              else {
                src.consumed = false;
              }
              //if (!src.consumed) {
                balance += src.amount;
              //}
              sources.push(src);
              sources[srcKey] = src;
            });
          }
          data.sources = sources;
          data.balance = balance;
          resolve();
        })
        .catch(function(err) {
          data.sources = [];
          reject(err);
        });
      });
    },

    loadTransactions = function() {
      return $q(function(resolve, reject) {
        // Get transactions
        BMA.tx.history.all({pubkey: data.pubkey})
        .then(function(res){
          var list = [];
          reduceTxAndPush(res.history.sent, list);
          reduceTxAndPush(res.history.received, list);
          reduceTxAndPush(res.history.sending, list);
          reduceTxAndPush(res.history.receiving, list);
          reduceTxAndPush(res.history.pending, list);

          data.history = list.sort(function(tx1, tx2) {
             return tx2.time - tx1.time;
          });
          resolve();
        })
        .catch(function(err) {
          data.history = [];
          reject(err);
        });
      });
    },

    loadAvatar = function() {
      return $q(function(resolve, reject) {
        if (!Registry) {
          data.avatar = null;
          resolve();
          return;
        }
        Registry.record.avatar({issuer:data.pubkey, category:'particulier'})
          .then(function(res) {
            if (res.hits.total > 0) {
              data.avatar = res.hits.hits.reduce(function(res, hit) {
                return res.concat(hit._source.pictures.reduce(function(res, pic) {
                  return res.concat(pic.src);
                }, [])[0]);
              }, [])[0];
            }
            else {
              data.avatar = null;
            }
            resolve();
          })
          .catch(function(err) {
            data.avatar = null; // silent !
            resolve();
          });
      });
    },

    loadData = function(refresh) {
        if (data.loaded) {
          return refreshData();
        }

        return $q(function(resolve, reject){
          data.loaded = false;

          $q.all([

            // Get currency parameters
            BMA.currency.parameters()
              .then(function(json){
                data.currency = json.currency;
                data.sigQty = json.sigQty;
              }),

            // Get the UD informations
            BMA.blockchain.stats.ud()
              .then(function(res){
                if (res.result.blocks.length) {
                  var lastBlockWithUD = res.result.blocks[res.result.blocks.length - 1];
                  return BMA.blockchain.block({ block: lastBlockWithUD })
                    .then(function(block){
                      data.currentUD = block.dividend;
                    });
                  }
              }),

            // Get sources
            loadSources(false),

            // Get requirements
            loadRequirements(),

            // Get transactions
            loadTransactions(),

            // Get avatar
            loadAvatar()
          ])
          .then(function() {
            data.loaded = true;
            resolve(data);
          })
          .catch(function(err) {
            data.loaded = false;
            reject(err);
          });
        });
    },

    refreshData = function() {
        return $q(function(resolve, reject){
          $q.all([

            // Get the UD informations
            BMA.blockchain.stats.ud()
              .then(function(res){
                if (res.result.blocks.length) {
                  var lastBlockWithUD = res.result.blocks[res.result.blocks.length - 1];
                  return BMA.blockchain.block({ block: lastBlockWithUD })
                    .then(function(block){
                      data.currentUD = block.dividend;
                    });
                  }
              }),

            // Get requirements
            loadRequirements(),

            // Get sources
            loadSources(true),

            // Get transactions
            loadTransactions()
          ])
          .then(function() {
            resolve(data);
          }).catch(function(err){reject(err);});
        });
    },

    /**
    * Send a new transaction
    */
    transfer = function(destPub, amount, comments) {
        return $q(function(resolve, reject) {

            if (!isLogin()){
              reject('Wallet required to be login first.'); return;
            }
            if (!amount) {
              reject('amount must not be null'); return;
            }
            amount = Math.round(amount);
            if (amount <= 0) {
              reject('amount must be greater than zero'); return;
            }
            if (amount > data.balance) {
              reject('Not enought credit'); return;
            }

            var tx = "Version: 2\n";
            tx += "Type: Transaction\n";
            tx += "Currency: " + data.currency + "\n";
            tx += "Locktime: 0" + "\n"; // no lock
            tx += "Issuers:\n";
            tx += data.pubkey + "\n";
            tx += "Inputs:\n";
            var sourceAmount = 0;
            var outputBase = 0;
            var inputs = [];
            var i;
            for (i = 0; i<data.sources.length; i++) {
              var input = data.sources[i];
              if (!input.consumed){
                // if D : D:PUBLIC_KEY:BLOCK_ID
                // if T : T:T_HASH:T_INDEX
                tx += input.type +":"+input.identifier+":"+input.noffset+"\n";
                sourceAmount += input.amount;
                inputs.push(input);
                if (sourceAmount >= amount) {
                  break;
                }
              }
            }

            if (sourceAmount < amount) {
              if (sourceAmount === 0) {
                reject('ERROR.ALL_SOURCES_USED');
              }
              else {
                console.error('Maximum transaction sources has been reached: ' + (data.useRelative ? (sourceAmount / data.currentUD)+' UD' : sourceAmount));
                reject('ERROR.NOT_ENOUGH_SOURCES');
              }
              return;
            }

            tx += 'Unlocks:\n';
            for (i=0; i<inputs.length; i++) {
                 // INPUT_INDEX:UNLOCK_CONDITION
                tx += i + ':SIG(0)\n';
            }

            tx += 'Outputs:\n';
            // AMOUNT:BASE:CONDITIONS
            tx += amount + ':'+outputBase+':SIG('+destPub+')\n';
            if (sourceAmount > amount) {
              tx += (sourceAmount-amount)+':'+outputBase+':SIG('+data.pubkey+')\n';
            }

            tx += "Comment: "+ (!!comments?comments:"") + "\n";

            CryptoUtils.sign(tx, data.keypair)
            .then(function(signature) {
              var signedTx = tx + signature + "\n";
              BMA.tx.process({transaction: signedTx})
              .then(function(result) {
                data.balance -= amount;
                for(var i=0;i<inputs.length;i++)inputs[i].consumed=true;
                resolve(result);
              }).catch(function(err){reject(err);});
            }).catch(function(err){reject(err);});
        });
    },

    /**
    * Send self identity
    */
    self = function(uid, requirements) {
      return $q(function(resolve, reject) {

        BMA.blockchain.current()
        .then(function(block) {
          // Create identity to sign
          var identity = 'Version: 2\n' +
                    'Type: Identity\n' +
                    'Currency: ' + data.currency + '\n' +
                    'Issuer: ' + data.pubkey + '\n' +
                    'UniqueID: ' + uid + '\n' +
                    'Timestamp: ' + block.number + '-' + block.hash + '\n';

          CryptoUtils.sign(identity, data.keypair)
          .then(function(signature) {
            var signedIdentity = identity + signature + '\n';
            // Send signed identity
            BMA.wot.add({identity: signedIdentity})
            .then(function(result) {
              if (!!requirements) {
              // Refresh membership data
                loadRequirements()
                .then(function() {
                  resolve();
                }).catch(function(err){reject(err);});
              }
              else {
                data.blockUid = block.number + '-' + block.hash;
                resolve();
              }
            }).catch(function(err){reject(err);});
          }).catch(function(err){reject(err);});
        }).catch(function(err){reject(err);});
      });
    },

   /**
    * Send membership (in)
    */
    membership = function(sideIn) {
      return $q(function(resolve, reject) {
        BMA.blockchain.current()
        .then(function(block) {
          // Create membership to sign
           var membership = 'Version: 2\n' +
                   'Type: Membership\n' +
                   'Currency: ' + data.currency + '\n' +
                   'Issuer: ' + data.pubkey + '\n' +
                   'Block: ' + block.number + '-' + block.hash + '\n' +
                   'Membership: ' + (!!sideIn ? "IN" : "OUT" ) + '\n' +
                   'UserID: ' + data.uid + '\n' +
                   'CertTS: ' + data.blockUid + '\n';

          CryptoUtils.sign(membership, data.keypair)
          .then(function(signature) {
            var signedMembership = membership + signature + '\n';
            // Send signed membership
            BMA.blockchain.membership({membership: signedMembership})
            .then(function(result) {
              // Refresh membership data
              loadRequirements()
              .then(function() {
                resolve();
              }).catch(function(err){reject(err);});
            }).catch(function(err){reject(err);});
          }).catch(function(err){reject(err);});
        }).catch(function(err){reject(err);});
      });
    },

    /**
    * Send identity certification
    */
    sign = function(uid, pubkey, timestamp, signature) {
      return $q(function(resolve, reject) {

        BMA.blockchain.current()
        .then(function(block) {
          // Create the self part to sign
          var self = 'UID:' + uid + '\n' +
                   'META:TS:' + timestamp + '\n' +
                   signature /*+"\n"*/;

          var cert = self + '\n' +
                'META:TS:' + block.number + '-' + block.hash + '\n';

          CryptoUtils.sign(cert, data.keypair)
          .then(function(signature) {
            var inlineCert = data.pubkey +
                ':' + pubkey +
                ':' + block.number +
                ':' + signature + '\n';
            BMA.wot.add({pubkey: pubkey, self: self, other: inlineCert})
              .then(function(result) {
                resolve(result);
              }).catch(function(err){reject(err);});
          }).catch(function(err){reject(err);});
        }).catch(function(err){reject(err);});
      });
    },

    /**
    * Serialize to JSON string
    */
    toJson = function() {
      return $q(function(resolve, reject) {
        var json = JSON.stringify(data);
        resolve(json);
      });
    },

    /**
    * De-serialize from JSON string
    */
    fromJson = function(json) {
      return $q(function(resolve, reject) {
        var obj = JSON.parse(json || '{}');
        if (obj.keypair) {
          var keypair = obj.keypair;
          var i;

          // Convert to Uint8Array type
          var signPk = new Uint8Array(32);
          for (i = 0; i < 32; i++) signPk[i] = keypair.signPk[i];
          keypair.signPk = signPk;

          var signSk = new Uint8Array(64);
          for (i = 0; i < 64; i++) signSk[i] = keypair.signSk[i];
          keypair.signSk = signSk;

          data.pubkey = obj.pubkey;
          data.keypair = keypair;

          resolve();
        }
        else {
          reject('Not a valid Wallet.data object');
        }
      });
    };

    return {
      id: id,
      data: data,
      // auth
      login: login,
      logout: logout,
      isLogin: isLogin,
      getData: getData,
      loadData: loadData,
      refreshData: refreshData,
      // operations
      transfer: transfer,
      self: self,
      membership: membership,
      sign: sign,
      // serialization
      toJson: toJson,
      fromJson: fromJson
    };
  };

  var service = Wallet('default');
  service.instance = service;
  return service;
}])
;
