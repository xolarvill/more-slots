# 书签栏与跨设备同步调研

调研日期：2026-10-25。本文保留 1.2.0 时的方案调研。后续 1.3.1 已统一固定 ID，1.4.0 已接入可选的 Chrome Sync，当前用法见 [Chrome Sync 说明](chrome-sync.md)。

## 书签栏

当前 manifest 没有 `bookmarks` 权限，代码没有修改原生书签或书签栏设置。书签栏由 Chrome 浏览器绘制，不属于扩展页面 DOM，不能用页面 CSS 恢复或移动。

先在 Chrome 菜单「书签和列表 → 显示书签栏」恢复显示。快捷键为 Windows/Linux `Ctrl+Shift+B`，Mac `Command+Shift+B`。如果外观设置提供「始终显示 / 仅在新标签页显示 / 始终隐藏」，可先选择「始终显示」排查；这会使其他网页也显示书签栏。尚未读取用户设备实际的外观设置，不能确认本次消失的具体原因。新标签页被替换后没有沿用原生页面的自动展示行为，是待核实的可能原因。

若要求其他页面隐藏、仅在扩展页显示，而当前 Chrome 不支持原生栏的这种行为，可另做可选的页面内书签栏；这需要 `bookmarks` 权限，并且应区分本机和账号的书签目录。它与 Chrome 原生书签栏仍是两个不同界面，不能声称完全恢复原生栏。

用户已确认需要保留「普通网页隐藏、仅新标签页显示」的行为。因此不应把全局改成「始终显示」作为最终方案。查阅当前 Chromium `BookmarkBarController::IsShowingNTP()`，自动显示依赖浏览器对原生 NTP 的内部识别；公开的 `chrome.bookmarks` API 没有原生栏可见性控制。可行方案是在本扩展页面顶部读取并展示真实书签，仅在此页面存在，保持全局显示设置不变。需要书签权限，但实现可只读，避免改动书签数据。

源码依据：[Chromium 书签栏控制器](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/ui/bookmarks/bookmark_bar_controller.cc)。

## 同步方案比较

| 方案 | 优点 | 前提与限制 | 适用情况 |
| --- | --- | --- | --- |
| Chrome `storage.sync` | 无需单独的 Drive 登录或自建服务器；离线时本机保存，联网后由 Chrome 同步 | 同一扩展 ID、Chrome 账号及相应同步开关；总配额约 100 KB，单项约 8 KB；开发者模式的真实跨设备行为需要实测 | 主要在 Mac/Windows Chrome 之间同步，数据规模较小 |
| Google Drive `appDataFolder` | 专用配置空间，无 `storage.sync` 的 100 KB 配额约束；可实现多版本快照 | 独立 Google Cloud 项目、Drive API、OAuth 客户端和用户授权；需自行处理重试、离线队列与冲突 | 大量快捷方式，或需要独立于 Chrome Sync 的同步和备份 |
| Chrome 专用书签文件夹 | 把快捷方式存为专用目录内的真实书签，利用 Chrome 的书签同步及顺序同步 | 需要 `bookmarks` 读写权限；必须选择已同步的账号书签目录；外观设置另存；不得修改其他书签 | 希望快捷方式本来就是一组可在 Chrome 书签管理器维护的书签 |
| 现有 JSON 导出/导入 + 云盘保管 | 现在即可用，无需新账号授权逻辑 | 是手动备份/迁移，不是自动同步 | 过渡方案与恢复备份 |

### Chrome Sync 的项目特定问题

调研时的旧版本 manifest 没有固定 `key`，手动加载时不同机器/路径可能得到不同 ID。1.3.1 已将公钥直接写入 `extension/manifest.json`，直接加载该目录即可获得一致 ID；1.4.0 已接入可选同步。

实施前需确定统一的扩展 ID 和分发方式，并保留旧版数据迁移路径。新增 `key` 可能改变现有安装的 ID，导致 Chrome 将其识别为新扩展；应先导出旧数据，再迁移，不能直接修改后宣称原有数据仍在。

当前代码只使用 `storage.local`。不能简单把名称替换为 `storage.sync`：现有整个状态保存在一个键中，可能超过单项 8 KB；即使分片也不能突破总计 100 KB 的限制。需要按实际序列化大小检查配额、控制写入频率并处理超限回退。1000 个快捷方式的支持上限不等于 1000 个都必然能同步。

按当前实际数据结构，用预置链接长度和 UUID 生成代表性样本，序列化 UTF-8 大小为：6 个 696 字节、30 个 2980 字节、50 个 4882 字节、100 个 9633 字节；不含图片。这说明当前这类几十到一两百个普通链接的使用规模适合先选 Chrome Sync，100 个样本已需要拆分成多个存储项。实际用量仍取决于名称与网址长度，以及同步协议的版本/删除标记等额外信息。

自动同步需要用两个独立设备、同一扩展 ID 和已启用的 Chrome 同步做端到端验证；本机调用 `storage.sync.set()` 成功不代表数据已经到另一台设备。

### Google Drive 的可行实现

使用 `drive.appdata` 权限，在应用专用的隐藏 `appDataFolder` 保存配置；这个目录不在普通 Drive 文件列表显示，仅该应用可访问。无需申请整个云盘的读写权限。

若用户希望直接在 Drive 网页看见备份，可改用 `drive.file`，只管理由应用创建或经用户选择的备份文件。OAuth 客户端需与扩展身份匹配。聊天中的 Google Drive 连接不会自动成为安装在用户电脑上的扩展的登录凭据。

Drive API 提供存储和读写，并不自动提供本应用的合并算法。首次连接时已有本机/云端两份数据、两台设备同时离线修改、删除和排序冲突，都需要明确处理，并保存可恢复快照，避免新设备默认列表覆盖云端已有列表。

### 建议

主要在 Chrome 之间使用、实际数据量较小时，优先验证 Chrome Sync。若经常接近 1000 个链接，或需要独立的备份和更大容量，Drive 更适合作为同步后端。专用书签目录是另一条可行路线，但会改变快捷方式的数据模型，适合作为用户主动选择的模式。

建议同步快捷方式名称、网址、删除状态和排序；列数与主题提供本机覆盖选项；搜索记录默认保持本机；网站图标仍由每台 Chrome 读取缓存，不同步旧图片。原生 Chrome 书签如已启用账号同步，继续由 Chrome 管理。

## 官方依据

- [Chrome：创建、查找和编辑书签](https://support.google.com/chrome/answer/188842)
- [Chrome：快捷键](https://support.google.com/chrome/answer/157179)
- [Chrome 扩展：Storage API 与配额](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome 扩展：保持一致的扩展 ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Chrome 扩展：Google OAuth](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)
- [Drive：应用专用数据文件夹](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Drive：权限范围](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Chrome 扩展：书签 API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks)
- [Chrome：账号书签与本机书签目录的 API 变化](https://developer.chrome.com/blog/bookmarks-sync-changes)
