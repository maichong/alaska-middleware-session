/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-06
 * @author Liang <liang@maichong.it>
 */

'use strict';

const Session = require('./session');
const random = require('string-random');
const pathToRegexp = require('path-to-regexp');

module.exports = function (options) {
  const storeOpts = options.store || {};
  const cookieOpts = options.cookie || {};
  const key = cookieOpts.key || 'alaska.sid';
  const Store = require(storeOpts.type);
  const store = new Store(storeOpts);
  let ignore = null;

  function convert(input) {
    if (typeof input === 'string') {
      ignore.push(pathToRegexp(input));
    } else if (input.test) {
      ignore.push(input);
    } else if (input instanceof Function) {
      ignore.push(input);
    }
  }

  if (options.ignore) {
    ignore = [];

    if (Array.isArray(options.ignore)) {
      options.ignore.forEach(convert);
    } else {
      convert(options.ignore);
    }
  }

  return function sessionMiddleware(ctx, next) {
    if (ignore) {
      for (let reg of ignore) {
        if (reg.test) {
          if (reg.test(ctx.path)) return next();
        } else if (reg(ctx)) {
          return next();
        }
      }
    }
    return new Promise((resolve, reject) => {
      ctx.sessionKey = key;
      let sid = ctx.sessionId = ctx.cookies.get(key, cookieOpts);
      let json;
      let session;

      if (sid) {
        store.get(sid).then(res => {
          json = res || null;
          onGetSession();
        }, onGetSession);
      } else {
        sid = ctx.sessionId = random(24);
        ctx.cookies.set(key, sid, cookieOpts);
        onGetSession();
      }

      function onGetSession() {
        if (json) {
          ctx.sessionId = sid;
          try {
            session = new Session(ctx, json);
          } catch (err) {
            if (!(err instanceof SyntaxError)) {
              return reject(err);
            }
            session = new Session(ctx, {});
          }
        } else {
          session = new Session(ctx, {});
        }

        ctx.__defineGetter__('session', function () {
          if (session) return session;
          if (session === false) return null;
        });

        ctx.__defineSetter__('session', function (val) {
          if (val === null) return (session = false);
          if (typeof val === 'object') return (session = new Session(ctx, val));
          throw new Error('ctx.session can only be set as null or an object.');
        });

        let jsonString = JSON.stringify(json);

        function onNext() {
          if (session === false) {
            // 清除Session
            ctx.cookies.set(key, '', cookieOpts);
            store.del(sid);
          } else if (!json && !session.length) {
            // 未更改
          } else if (session.isChanged(jsonString)) {
            // 保存
            json = session.toJSON();
            store.set(sid, json);
          }
        }

        next().then(() => {
          onNext();
          resolve();
        }, error => {
          onNext();
          reject(error);
        });
      }
    });
  };
};
