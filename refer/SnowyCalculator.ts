/**
 * 简易多人模式歌曲 PT 计算器
/

// ======================== 类型定义 ========================

export interface MusicMeta {
  music_id: number
  difficulty: string
  music_time: number
  base_score: number
  fever_score: number
  tap_count: number
  skill_score_solo: number[]
  /** 多人模式 6 个技能槽权重 [slot0 .. slot4, slot5(Skill6)] */
skill_score_multi: number[]
skill_score_auto: number[]
base_score_auto: number
}

export interface PlayerConfig {
    /** 综合力 */
    power: number
    /** 实效（%） */
    effectiveness: number
}

/** Skill6 触发模式 */
export enum Skill6Mode {
    /** 全队 5 人实效的算术平均 */
    TEAM_AVERAGE = 'team_average',
    /** 综合力最高的玩家对应实效 */
    HIGHEST_POWER = 'highest_power',
}

/** Skill1-5 排列策略 */
export enum Skill15Strategy {
    /** 期望值（所有排列等概率的数学期望） */
    EXPECTED = 'expected',
    /** 最优排列（实效高 ↔ 权重高） */
    BEST = 'best',
    /** 最差排列（实效高 ↔ 权重低） */
    WORST = 'worst',
}

export interface CalculationResult {
    score: number
    baseScorePart: number
    skill15Part: number
    skill6Part: number
    activeBonus: number
    totalPower: number
    skill6Effectiveness: number
    skill6Mode: Skill6Mode
    skill15Strategy: Skill15Strategy
    details: {
        baseRate: number
        skill15Contribution: number
        skill6Contribution: number
        totalRate: number
        userPower: number
        allPlayers: PlayerConfig[]
        /** 当权重不全相同时，最优/最差得分参考 */
        scoreBest: number
        scoreWorst: number
    }
}

// ======================== 核心计算器 ========================

export class MultiLivePTCalculator {
    private teammates: PlayerConfig[]
    private _skill6Mode: Skill6Mode
    private _skill15Strategy: Skill15Strategy

    constructor(
        defaultPower: number = 200_000,
        defaultEffectiveness: number = 200,
    ) {
        this.teammates = Array.from({ length: 4 }, () => ({
            power: defaultPower,
            effectiveness: defaultEffectiveness,
        }))
        this._skill6Mode = Skill6Mode.TEAM_AVERAGE
        this._skill15Strategy = Skill15Strategy.EXPECTED
    }

    // ───────── 队友配置 ─────────

    setTeammate(index: number, power: number, effectiveness: number): void {
        if (index < 0 || index >= 4) throw new RangeError(`index 须为 0-3, 当前: ${index}`)
        this.teammates[index] = { power, effectiveness }
    }

    setAllTeammates(power: number, effectiveness: number): void {
        for (let i = 0; i < 4; i++) this.teammates[i] = { power, effectiveness }
    }

    getTeammates(): readonly PlayerConfig[] {
        return this.teammates
    }

    // ───────── Skill6 模式 ─────────

    setSkill6Mode(mode: Skill6Mode): void {
        this._skill6Mode = mode
    }

    get skill6Mode(): Skill6Mode {
        return this._skill6Mode
    }

    toggleSkill6Mode(): Skill6Mode {
        this._skill6Mode =
            this._skill6Mode === Skill6Mode.TEAM_AVERAGE
                ? Skill6Mode.HIGHEST_POWER
                : Skill6Mode.TEAM_AVERAGE
        return this._skill6Mode
    }

    // ───────── Skill1-5 策略 ─────────

    setSkill15Strategy(strategy: Skill15Strategy): void {
        this._skill15Strategy = strategy
    }

    get skill15Strategy(): Skill15Strategy {
        return this._skill15Strategy
    }

    // ───────── 计算 ─────────

    calculate(
        userPower: number,
        userEffectiveness: number,
        musicMeta: MusicMeta,
    ): CalculationResult {
        const w = musicMeta.skill_score_multi
        if (!w || w.length < 6) {
            throw new Error(`skill_score_multi 须含 6 个权重, 当前: ${w?.length ?? 0}`)
        }

        // 全部 5 名玩家（用户 + 4 队友）
        const allPlayers: PlayerConfig[] = [
            { power: userPower, effectiveness: userEffectiveness },
            ...this.teammates.map((t) => ({ ...t })),
        ]

        // ① baseRate（多人含 50% Fever）
        const baseRate = musicMeta.base_score + musicMeta.fever_score * 0.5

        // ② Skill 1-5 贡献（随机分配 → 按策略处理）
        const w15 = w.slice(0, 5)
        const effs = allPlayers.map((p) => p.effectiveness)
        const skill15Contribution = this.computeSkill15(effs, w15, this._skill15Strategy)

        // 同时算出最优/最差用于参考
        const skill15Best = this.computeSkill15(effs, w15, Skill15Strategy.BEST)
        const skill15Worst = this.computeSkill15(effs, w15, Skill15Strategy.WORST)

        // ③ Skill 6 贡献
        const skill6Eff = this.resolveSkill6Effectiveness(allPlayers)
        const skill6Contribution = skill6Eff * w[5] / 100

        // ④ 活跃加分 = 5 × 1.5% × 全队总综合
        const totalPower = allPlayers.reduce((s, p) => s + p.power, 0)
        const activeBonus = 5 * 0.015 * totalPower

        // ⑤ 总比率
        const totalRate = baseRate + skill15Contribution + skill6Contribution

        // ⑥ 最终得分
        const score = Math.floor(totalRate * userPower * 4 + activeBonus)

        // 最优/最差得分参考
        const scoreBest = Math.floor(
            (baseRate + skill15Best + skill6Contribution) * userPower * 4 + activeBonus,
        )
        const scoreWorst = Math.floor(
            (baseRate + skill15Worst + skill6Contribution) * userPower * 4 + activeBonus,
        )

        return {
            score,
            baseScorePart: Math.floor(baseRate * userPower * 4),
            skill15Part: Math.floor(skill15Contribution * userPower * 4),
            skill6Part: Math.floor(skill6Contribution * userPower * 4),
            activeBonus: Math.floor(activeBonus),
            totalPower,
            skill6Effectiveness: skill6Eff,
            skill6Mode: this._skill6Mode,
            skill15Strategy: this._skill15Strategy,
            details: {
                baseRate,
                skill15Contribution,
                skill6Contribution,
                totalRate,
                userPower,
                allPlayers,
                scoreBest,
                scoreWorst,
            },
        }
    }

    calculateSimple(
        userPower: number,
        userEffectiveness: number,
        baseScore: number,
        feverScore: number,
        skillScoreMulti: number[],
    ): CalculationResult {
        return this.calculate(userPower, userEffectiveness, {
            music_id: 0, difficulty: '', music_time: 0,
            base_score: baseScore, fever_score: feverScore,
            tap_count: 0,
            skill_score_solo: [], skill_score_multi: skillScoreMulti,
            skill_score_auto: [], base_score_auto: 0,
        })
    }

    // ───────── 内部方法 ─────────

    /**
     * 计算 Skill1-5 的贡献
     *
     *  5 名玩家的实效 effs[0..4] 随机分配到 5 个权重 w[0..4]
     *
     *  EXPECTED: E[贡献] = avg(effs) × Σw / 100
     *     数学推导: E[Σ e_{σ(i)}·w_i] = Σ w_i · E[e_{σ(i)}]
     *              = Σ w_i · avg(e)   = avg(e) · Σw
     *
     *  BEST:    实效降序 × 权重降序 逐位相乘再求和
     *  WORST:   实效降序 × 权重升序 逐位相乘再求和
     */
    private computeSkill15(
        effs: number[],
        weights: number[],
        strategy: Skill15Strategy,
    ): number {
        const n = effs.length // 5
        switch (strategy) {
            case Skill15Strategy.EXPECTED: {
                const avgEff = effs.reduce((s, e) => s + e, 0) / n
                const sumW = weights.reduce((s, w) => s + w, 0)
                return avgEff * sumW / 100
            }
            case Skill15Strategy.BEST: {
                const sortedEff = [...effs].sort((a, b) => b - a)   // 降序
                const sortedW = [...weights].sort((a, b) => b - a)  // 降序
                return sortedEff.reduce((s, e, i) => s + e * sortedW[i] / 100, 0)
            }
            case Skill15Strategy.WORST: {
                const sortedEff = [...effs].sort((a, b) => b - a)   // 降序
                const sortedW = [...weights].sort((a, b) => a - b)  // 升序
                return sortedEff.reduce((s, e, i) => s + e * sortedW[i] / 100, 0)
            }
        }
    }

    private resolveSkill6Effectiveness(allPlayers: PlayerConfig[]): number {
        if (this._skill6Mode === Skill6Mode.TEAM_AVERAGE) {
            return allPlayers.reduce((s, p) => s + p.effectiveness, 0) / allPlayers.length
        }
        return allPlayers.reduce(
            (best, p) => (p.power > best.power ? p : best),
            allPlayers[0],
        ).effectiveness
    }
}

// ======================== 格式化输出 ========================

export function printResult(result: CalculationResult): void {
    const s6Label =
        result.skill6Mode === Skill6Mode.TEAM_AVERAGE ? '全队平均实效' : '最高综合实效'
    const s15Label = ({
        [Skill15Strategy.EXPECTED]: '期望值(随机)',
        [Skill15Strategy.BEST]: '最优排列',
        [Skill15Strategy.WORST]: '最差排列',
    })[result.skill15Strategy]

    const pad = (v: string) => v.padStart(14)

    console.log('╔════════════════════════════════════════════╗')
    console.log(`║  最终得分        ${pad(result.score.toLocaleString())}   ║`)
    console.log(`║  ├ 基础分        ${pad(result.baseScorePart.toLocaleString())}   ║`)
    console.log(`║  ├ Skill1-5 分   ${pad(result.skill15Part.toLocaleString())}   ║`)
    console.log(`║  ├ Skill6 分     ${pad(result.skill6Part.toLocaleString())}   ║`)
    console.log(`║  └ 活跃加分      ${pad(result.activeBonus.toLocaleString())}   ║`)
    console.log(`║  ─────────────────────────────────────────  ║`)
    console.log(`║  全队综合力      ${pad(result.totalPower.toLocaleString())}   ║`)
    console.log(`║  Skill6 实效     ${pad(result.skill6Effectiveness.toFixed(1))}   ║`)
    console.log(`║  Skill6 模式     ${pad(s6Label)}   ║`)
    console.log(`║  Skill1-5 策略   ${pad(s15Label)}   ║`)
    console.log(`║  ─────────────────────────────────────────  ║`)
    console.log(`║  最优排列得分    ${pad(result.details.scoreBest.toLocaleString())}   ║`)
    console.log(`║  最差排列得分    ${pad(result.details.scoreWorst.toLocaleString())}   ║`)
    console.log(`║  波动幅度        ${pad(
        `±${((result.details.scoreBest - result.details.scoreWorst) / 2).toLocaleString()}`
    )}   ║`)
    console.log('╚════════════════════════════════════════════╝')
}

// ======================== 使用示例 ========================

function main(): void {
    // 1. 创建计算器（队友默认: 综合 200000, 实效 200）
    const calc = new MultiLivePTCalculator(200_000, 200)

    // 可选：设置不同队友
    // calc.setTeammate(0, 250_000, 260)
    // calc.setTeammate(1, 220_000, 210)

    // 2. 歌曲数据（请替换为实际值）
    //    注意: 当 w[0..4] 不全相同时，随机分配才有波动
    const song: MusicMeta = {
        music_id: 49,
        difficulty: 'master',
        music_time: 126,
        base_score: 1.578,
        fever_score: 0.251,
        tap_count: 964,
        skill_score_solo: [5.0, 5.2, 5.4, 5.6, 5.8, 5.6],
        skill_score_multi: [5.0, 5.2, 5.4, 5.6, 5.8, 5.6], // 槽位权重不同 → 有波动
        skill_score_auto: [5.0, 5.2, 5.4, 5.6, 5.8, 5.6],
        base_score_auto: 1.1,
    }

    // 3. 用户输入
    const myPower = 280_000
    const myEffectiveness = 250

    // ── 场景 A: Skill6=全队平均, Skill1-5=期望值 ──
    calc.setSkill6Mode(Skill6Mode.TEAM_AVERAGE)
    calc.setSkill15Strategy(Skill15Strategy.EXPECTED)
    console.log('\n【A】Skill6=全队平均 / Skill1-5=期望值')
    printResult(calc.calculate(myPower, myEffectiveness, song))

    // ── 场景 B: Skill6=最高综合, Skill1-5=期望值 ──
    calc.setSkill6Mode(Skill6Mode.HIGHEST_POWER)
    console.log('\n【B】Skill6=最高综合实效 / Skill1-5=期望值')
    printResult(calc.calculate(myPower, myEffectiveness, song))

    // ── 场景 C: Skill6=全队平均, Skill1-5=最优排列 ──
    calc.setSkill6Mode(Skill6Mode.TEAM_AVERAGE)
    calc.setSkill15Strategy(Skill15Strategy.BEST)
    console.log('\n【C】Skill6=全队平均 / Skill1-5=最优排列')
    printResult(calc.calculate(myPower, myEffectiveness, song))

    // ── 场景 D: Skill6=全队平均, Skill1-5=最差排列 ──
    calc.setSkill15Strategy(Skill15Strategy.WORST)
    console.log('\n【D】Skill6=全队平均 / Skill1-5=最差排列')
    printResult(calc.calculate(myPower, myEffectiveness, song))
}

main()