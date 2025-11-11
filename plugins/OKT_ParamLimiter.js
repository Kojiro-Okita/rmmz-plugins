/*:
 * @target MZ
 * @plugindesc v1.0 標準能力値に上下限とリミットブレイクを導入します。 
 * @author 沖田小次郎
 *
 * @help OKT_ParamLimiter.js
 * 
 * 標準パラメータに上下限とリミットブレイク用の上限を設定し、
 * 装備の <LimitBreak> タグで上限突破させる能力値を指定できるプラグインです。
 * 
 * ・装備や職業、ステート、他プラグインによる補正を含む「最終結果」に対して作用します。
 * ・min / max / breakMin / breakMax には、数値だけでなく
 *   「変数」「ParamX(AddParam連携)」も指定できます。
 * 
 * 【min / max / breakMin / breakMax に書ける値】
 *   1) 数値       例: 0 / 9999
 *   2) V[n]       例: V[10]   → 変数10番の値
 *      VarN       例: Var10   → 同上
 *   3) paramX     例: param8  → OKT_AddParamでID8に設定した拡張パラメーター
 * 
 * ------------------------------------------------------------
 * 【LimitBreak の仕様】
 * 
 * 武器・防具のメモ欄に
 *   <LimitBreak>
 *   <LimitBreak[2]>
 *   <LimitBreak[0,2,4]>
 * のように記述することで、「どのパラメータだけ breakMin/breakMax を使うか」を指定できます。
 * 
 * ・<LimitBreak>           → 全パラメータで LimitBreak 有効
 * ・<LimitBreak[2]>        → ParamID 2（攻撃力）のみ LimitBreak 有効
 * ・<LimitBreak[0,2,4]>    → ParamID 0,2,4 で LimitBreak 有効
 * 
 * LimitBreak は「装備に対してのみ」判定します。
 * ステートに <LimitBreak> を書いても、このプラグインの判定には影響しません
 * （ステートの倍率自体は通常どおり param 計算に含まれます）。
 * 
 * 例）
 *   攻撃力設定: min=0, max=999, breakMin=0, breakMax=9999
 *   アクター素の攻撃力 = 900
 *   武器A: 攻撃+500           （タグなし）
 *   武器B: 攻撃+500 <LimitBreak[2]>
 * 
 *   ・武器Aだけ装備 → 900 + 500 = 1400 → 通常枠 [0,999] → 999
 *   ・武器Bだけ装備 → 900 + 500 = 1400 → ParamID 2 は Break 枠 [0,9999] → 1400
 * 
 * ------------------------------------------------------------
 * 【最大HPについて】
 * 
 * 最大HP(paramId=0) だけは「開幕即ゲームオーバー」を避けるため、次のセーフティをかけます。
 *   ・min / breakMin が 1 未満または無効な値の場合 → 1 に補正
 *   ・max / breakMax が 1 未満または無効な値の場合 → 上限なし（Infinity）として扱う
 * 
 * これにより、上限を V[n] で指定したときに変数値が0でも
 * 「HP0スタートで即死」という状況を防ぎます。
 * 
 * ------------------------------------------------------------ * 
 * 免責：本プラグインの使用により発生したいかなる問題についても、作者は責任を負いません。
 * クレジットは任意（例: OKT_ParamLimiter / 沖田小次郎）。
 * 
 * @param 標準パラメータ設定
 * @type struct<BaseParamGroup>
 * @text 標準パラメータ設定
 */

/*~struct~BaseParamGroup:
 * @param hp
 * @text 最大HP設定
 * @type struct<BaseParamSetting>
 * @default {"min":"1","max":"9999","breakMin":"1","breakMax":"99999"}
 *
 * @param mp
 * @text 最大MP設定
 * @type struct<BaseParamSetting>
 * @default {"min":"0","max":"9999","breakMin":"0","breakMax":"99999"}
 *
 * @param atk
 * @text 攻撃力設定
 * @type struct<BaseParamSetting>
 * @default {"min":"0","max":"999","breakMin":"0","breakMax":"9999"}
 *
 * @param def
 * @text 防御力設定
 * @type struct<BaseParamSetting>
 * @default {"min":"0","max":"999","breakMin":"0","breakMax":"9999"}
 *
 * @param mat
 * @text 魔法力設定
 * @type struct<BaseParamSetting>
 * @default {"min":"0","max":"999","breakMin":"0","breakMax":"9999"}
 *
 * @param mdf
 * @text 魔法防御設定
 * @type struct<BaseParamSetting>
 * @default {"min":"0","max":"999","breakMin":"0","breakMax":"9999"}
 *
 * @param agi
 * @text 敏捷性設定
 * @type struct<BaseParamSetting>
 * @default {"min":"0","max":"999","breakMin":"0","breakMax":"9999"}
 *
 * @param luk
 * @text 運設定
 * @type struct<BaseParamSetting>
 * @default {"min":"0","max":"999","breakMin":"0","breakMax":"9999"}
 */

/*~struct~BaseParamSetting:
 * @param min
 * @text 下限値
 * @type string
 * @default 0
 *
 * @param max
 * @text 上限値
 * @type string
 * @default 9999
 *
 * @param breakMin
 * @text Break下限値
 * @type string
 * @default 0
 *
 * @param breakMax
 * @text Break上限値
 * @type string
 * @default 9999
 */

(() => {
    "use strict";

    const pluginName = "OKT_ParamLimiter";
    const params = PluginManager.parameters(pluginName);

    // 原実装 param の退避（ParamX評価時に再帰しないため）
    const _Game_BattlerBase_param = Game_BattlerBase.prototype.param;

    // struct<BaseParamSetting> を安全にパースして {min, max, breakMin, breakMax} に整形
    const parseSetting = (raw, defMin, defMax, defBreakMin, defBreakMax) => {
        let obj = null;
        if (typeof raw === "string" && raw !== "") {
            try { obj = JSON.parse(raw); } catch (_e) { obj = null; }
        } else if (raw && typeof raw === "object") {
            obj = raw;
        }
        const min = obj && obj.min != null ? String(obj.min) : String(defMin);
        const max = obj && obj.max != null ? String(obj.max) : String(defMax);
        const breakMin = obj && obj.breakMin != null ? String(obj.breakMin) : String(defBreakMin);
        const breakMax = obj && obj.breakMax != null ? String(obj.breakMax) : String(defBreakMax);
        return { min, max, breakMin, breakMax };
    };

    // 標準パラメータ設定（BaseParamGroup）をパース
    const groupRaw = params["標準パラメータ設定"];
    let group = {};
    if (typeof groupRaw === "string" && groupRaw !== "") {
        try { group = JSON.parse(groupRaw); } catch (_e) { group = {}; }
    }

    // paramId -> 設定
    // 0:MHP, 1:MMP, 2:ATK, 3:DEF, 4:MAT, 5:MDF, 6:AGI, 7:LUK
    const LIMIT_CONFIG = {
        0: parseSetting(group.hp, 1, 9999, 1, 99999),
        1: parseSetting(group.mp, 0, 9999, 0, 99999),
        2: parseSetting(group.atk, 0, 999, 0, 9999),
        3: parseSetting(group.def, 0, 999, 0, 9999),
        4: parseSetting(group.mat, 0, 999, 0, 9999),
        5: parseSetting(group.mdf, 0, 999, 0, 9999),
        6: parseSetting(group.agi, 0, 999, 0, 9999),
        7: parseSetting(group.luk, 0, 999, 0, 9999)
    };

    /**
     * 下限・上限用の式を評価する
     * @param {string} expr
     * @param {Game_BattlerBase} battler
     * @param {number} fallback
     * @param {number} selfParamId  自分自身の paramId（ParamX 自己参照を避けるため）
     * @returns {number}
     */
    const evalLimitExpr = (expr, battler, fallback, selfParamId) => {
        if (expr == null) return fallback;
        const s = String(expr).trim();
        if (!s) return fallback;

        // 純粋な数値
        if (/^[-+]?\d+$/.test(s)) {
            const n = Number(s);
            return Number.isFinite(n) ? n : fallback;
        }

        // 変数参照 V[n] / VarN
        let m = s.match(/^V\[(\d+)\]$/i) || s.match(/^Var(\d+)$/i);
        if (m) {
            const vid = Number(m[1]);
            if ($gameVariables && Number.isFinite(vid)) {
                const v = Number($gameVariables.value(vid));
                return Number.isFinite(v) ? v : fallback;
            }
            return fallback;
        }

        // ParamX（0〜7 → 原実装param, 8〜 → customParam があればそちら）
        m = s.match(/^Param(\d+)$/i);
        if (m) {
            const pid = Number(m[1]);
            if (!battler || !Number.isFinite(pid)) return fallback;

            // 自己参照は禁止（無限ループ回避）
            if (selfParamId != null && pid === selfParamId) return fallback;

            if (pid <= 7) {
                if (typeof _Game_BattlerBase_param === "function") {
                    const v = Number(_Game_BattlerBase_param.call(battler, pid));
                    return Number.isFinite(v) ? v : fallback;
                }
                return fallback;
            } else {
                if (typeof battler.customParam === "function") {
                    const v = Number(battler.customParam(pid));
                    return Number.isFinite(v) ? v : fallback;
                }
                return fallback;
            }
        }

        // それ以外は未対応 → フォールバック
        return fallback;
    };

    /**
     * 装備に付いている <LimitBreak> / <LimitBreak[...]> を見て、
     * 指定 paramId で Break を有効にするかどうか判定
     * @param {Game_BattlerBase} battler
     * @param {number} paramId
     */
    const hasLimitBreakFlag = (battler, paramId) => {
        if (!battler || !battler.equips) return false;
        const equips = battler.equips();

        for (const equip of equips) {
            if (!equip || typeof equip.note !== "string") continue;
            const note = equip.note;

            // <LimitBreak> / <LimitBreak[2]> / <LimitBreak[0,2,4]> をすべて拾う
            const re = /<LimitBreak(?:\[(.*?)\])?>/gi;
            let match;
            while ((match = re.exec(note))) {
                const inner = match[1]; // [] の中身（無ければ undefined）

                // [] なし → 全パラメータ対象
                if (!inner || !inner.trim()) {
                    return true;
                }

                // [] の中をカンマ区切りで ParamID 群として解釈
                const ids = inner
                    .split(",")
                    .map(s => Number(s.trim()))
                    .filter(Number.isFinite);

                if (ids.includes(paramId)) {
                    return true;
                }
            }
        }
        return false;
    };

    /**
     * paramId に対応する下限・上限を取得
     * @param {Game_BattlerBase} battler
     * @param {number} paramId
     * @returns {{min:number,max:number}}
     */
    const calcBounds = (battler, paramId) => {
        const conf = LIMIT_CONFIG[paramId];
        if (!conf) {
            // 設定無し → 無制限扱い
            return { min: -Infinity, max: Infinity };
        }

        // 各式を評価
        let min = evalLimitExpr(conf.min, battler, -Infinity, paramId);
        let max = evalLimitExpr(conf.max, battler, Infinity, paramId);
        let breakMin = evalLimitExpr(conf.breakMin, battler, min, paramId);
        let breakMax = evalLimitExpr(conf.breakMax, battler, max, paramId);

        // 最大HP(0)だけは安全側に補正
        if (paramId === 0) {
            if (!Number.isFinite(min) || min < 1) min = 1;
            if (!Number.isFinite(breakMin) || breakMin < 1) breakMin = 1;
            if (!Number.isFinite(max) || max < 1) max = Infinity;
            if (!Number.isFinite(breakMax) || breakMax < 1) breakMax = Infinity;
        }

        // 有限値に限り、min > max なら自動で入れ替え
        const fixOrder = (a, b) => {
            if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
                return [b, a];
            }
            return [a, b];
        };
        [min, max] = fixOrder(min, max);
        [breakMin, breakMax] = fixOrder(breakMin, breakMax);

        // LimitBreak 判定（ParamID別）
        const limitBreak = hasLimitBreakFlag(battler, paramId);

        const usedMin = limitBreak ? breakMin : min;
        const usedMax = limitBreak ? breakMax : max;

        return { min: usedMin, max: usedMax };
    };

    // 元の param() をラップして上下限クリップ
    Game_BattlerBase.prototype.param = function (paramId) {
        let value = _Game_BattlerBase_param.call(this, paramId);
        if (paramId >= 0 && paramId <= 7) {
            const bounds = calcBounds(this, paramId);
            if (Number.isFinite(bounds.min)) {
                value = Math.max(value, bounds.min);
            }
            if (Number.isFinite(bounds.max)) {
                value = Math.min(value, bounds.max);
            }
        }
        return value;
    };

    // \Param[a,p] : アクターaの標準パラメータpをそのまま表示
    (() => {
        const _convert = Window_Base.prototype.convertEscapeCharacters;

        Window_Base.prototype.convertEscapeCharacters = function (text) {
            text = _convert.call(this, text);

            // 引数を数値に解釈する（\v[n] 対応）
            const resolveArg = (arg) => {
                const s = String(arg).trim();
                if (!s) return 0;
                const m = s.match(/\\[Vv]\[(\d+)\]/);
                if (m) {
                    const vid = Number(m[1]);
                    return Number($gameVariables ? $gameVariables.value(vid) : 0) || 0;
                }
                const n = Number(s);
                return Number.isFinite(n) ? n : 0;
            };

            // aStr, pStr から actor と paramId を取得
            const resolveActorParam = (aStr, pStr) => {
                const actorId = resolveArg(aStr);
                const paramId = resolveArg(pStr);
                const actor = $gameActors ? $gameActors.actor(actorId) : null;
                return { actor, paramId };
            };

            // \Param[a,p]
            text = text.replace(/[\x1b\\]Param\[(.+?),(.+?)\]/gi, (_, aStr, pStr) => {
                const { actor, paramId } = resolveActorParam(aStr, pStr);
                if (!actor) return "0";

                const pid = Number.isFinite(paramId) ? Math.floor(paramId) : NaN;
                if (!(pid >= 0 && pid <= 7)) return "0"; // 標準パラメータのみ

                const v = Number(actor.param(pid));
                return String(Number.isFinite(v) ? Math.floor(v) : 0);
            });

            return text;
        };
    })();

})();
