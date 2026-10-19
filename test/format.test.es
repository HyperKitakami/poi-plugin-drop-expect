import test from 'node:test'
import assert from 'node:assert/strict'

import { costLine, fmtAmount, fmtBucket, fmtCount, fmtPercent, fmtWeighted } from '../views/format.es'

test('百分比：整数位末尾的 0 不能被吃掉', () => {
  // 回归：曾经把 '90' 修剪成 '9'，界面上显示「期望 9%」
  assert.equal(fmtPercent(0.9, 0), '90%')
  assert.equal(fmtPercent(0.8, 0), '80%')
  assert.equal(fmtPercent(1, 0), '100%')
  assert.equal(fmtPercent(0.5, 0), '50%')
})

test('百分比：小数位按需保留', () => {
  assert.equal(fmtPercent(0.01191), '1.191%')
  assert.equal(fmtPercent(0.03), '3%')
  assert.equal(fmtPercent(0.03, 2), '3%')
  assert.equal(fmtPercent(0.903, 1), '90.3%')
  assert.equal(fmtPercent(0.9, 1), '90%')
  assert.equal(fmtPercent(0), '0%')
})

test('百分比：脏输入显示占位符', () => {
  assert.equal(fmtPercent(NaN), '—')
  assert.equal(fmtPercent(undefined), '—')
  assert.equal(fmtPercent('0.5'), '—')
})

test('资源数值：上万折成「万」，桶保留一位小数', () => {
  assert.equal(fmtAmount(9999), '9,999')
  assert.equal(fmtAmount(10000), '1.0万')
  assert.equal(fmtAmount(28880), '2.9万')
  assert.equal(fmtAmount(0), '0')
  assert.equal(fmtAmount(null), '—')
  assert.equal(fmtBucket(0.3), '0.3')
  assert.equal(fmtBucket(22.8), '22.8')
  assert.equal(fmtBucket(123.4), '123')
})

test('次数与消耗行', () => {
  assert.equal(fmtCount(1234), '1,234')
  assert.equal(fmtCount(Infinity), '—')
  assert.equal(costLine(null), '—')
  assert.equal(
    costLine({ fuel: 28880, ammo: 31920, steel: 9120, bauxite: 3040, bucket: 22.8 }),
    '2.9万 / 3.2万 / 9,120 / 3,040 / 22.8',
  )
})

test('加权值：小于 100 保留一位小数，大数走万', () => {
  assert.equal(fmtWeighted(1380), '1,380')
  assert.equal(fmtWeighted(4500), '4,500')
  assert.equal(fmtWeighted(12345), '1.2万')
  assert.equal(fmtWeighted(12.34), '12.3')
  assert.equal(fmtWeighted(0), '0.0')
  assert.equal(fmtWeighted(null), '—')
  assert.equal(fmtWeighted(Infinity), '—')
})
