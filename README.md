# 价差监控黄页

十三个交易监控工具的一站式导航页，部署于 GitHub Pages。

线上地址：https://surfacebuaa-maker.github.io/spread-yellow-pages/

## 收录站点

| # | 名称 | 地址 |
|---|---|---|
| 01 | A股价差监控 | https://surfacebuaa-maker.github.io/spread-monitor-summary/ |
| 02 | BP股票价差监控 | https://surfacebuaa-maker.github.io/arb-spread-radar/ |
| 03 | 兆易创新价差监控 | https://gigadev-basis-monitor.surface-buaa139523.chatgpt.site |
| 04 | 科创50ETF价差监控 | https://star50-kstr-spread.surface-buaa139523.chatgpt.site |
| 05 | 长鑫科技价差监控 | https://cxmt-spread-watch.surface-buaa139523.chatgpt.site |
| 06 | 宇树科技价差监控 | https://unitree-basis-monitor.surface-buaa139523.chatgpt.site/ |
| 07 | 韩美海力士价差监控 | https://skhynix-skhy-spread.surface-buaa139523.chatgpt.site |
| 08 | Gate 股票合约价差监控 | https://surfacebuaa-maker.github.io/gate-spread-radar/ |
| 09 | OKX bStocks价差监控 | https://surfacebuaa-maker.github.io/sf-spread-monitor/ |
| 10 | Backpack × Binance 价差雷达 | https://backpack-spread-radar.surface-buaa139523.chatgpt.site |
| 11 | Hyperliquid 持仓上限监控 | https://hl-limit-watch.surface-buaa139523.chatgpt.site/ |
| 12 | PerpScope 股票合约收盘偏离监控 | https://surfacebuaa-maker.github.io/perpscope-stock-monitor/ |
| 13 | Anthropic 认购额度监控 | https://surfacebuaa-maker.github.io/spread-yellow-pages/anthropic/ |

## Anthropic 认购额度监控

`anthropic/` 仅显示 Bitget 公开轮与 Gate 的 Anthropic 认购统计，不含 Bitget VIP 轮，也不合计两家金额。重点是 Bitget 总认购上限、使用率、剩余额度、认购截止时间与本地页面阈值提醒。Gate 未公开总上限时显示未知，不能用申购金额判断其剩余额度。

后台由 `.github/workflows/anthropic-monitor.yml` 每小时第 3、8、13…58 分钟（UTC）触发，约每 5 分钟采集一次；GitHub 调度与发布可能延迟。页面每 60 秒读取已发布的 JSON，不需要页面保持打开即可采集。阈值提醒仅在浏览器页面打开时生效，无推送服务。

数据来自 Bitget 公开页面的结构化 IPO 数据和 Gate 认购页实际使用的匿名统计接口。采集器校验项目与轮次，源时间超过 15 分钟拒绝覆盖；失败保留上次金额和源时间，历史缺失不补零。`anthropic/data/` 保存真实历史记录，可导出 CSV。记录最多保留 90 天。

Pages 通过 GitHub Actions 发布。定时任务提交历史后在同一次运行上传并发布静态页面，避免 `GITHUB_TOKEN` 提交不会触发传统 Pages 构建的问题。可在 Actions 手动运行工作流立即采集。

本地验证：安装 `scripts/requirements.txt`，运行 `python -m unittest discover -s tests`；采集运行 `python scripts/collect_anthropic.py`。本地预览可在仓库目录运行 `python -m http.server 8765` 并打开 `/anthropic/`。
