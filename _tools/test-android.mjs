/* 安卓 App 工程静态校验
 *
 * 不编译（编译要 Android SDK），但把「工程有没有写对」的硬指标全查一遍：
 * 文件齐不齐、包名/版本号/入口地址对不对、WebView 关键设置在不在、
 * 备份导入导出的桥在不在、有没有偷偷申请敏感权限。
 *
 * 运行：NODE_PATH=<node_modules> node _tools/test-android.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const AND = path.resolve(ROOT, '..', 'ebbinghaus-kids-android');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  →  ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra ? '  →  ' + extra : '')); }
}

const rel = (p) => path.join(AND, p);
const read = (p) => (fs.existsSync(rel(p)) ? fs.readFileSync(rel(p), 'utf8') : '');
const exists = (p) => fs.existsSync(rel(p));

function main() {
  console.log('=== 安卓 App 工程静态校验 ===\n');
  ok(exists('app/src/main/java/com/stephenhsu/memorystation/MainActivity.kt'), 'A0 找到安卓工程目录', AND);

  /* ---------- A. 文件齐全 ---------- */
  [
    'settings.gradle.kts', 'build.gradle.kts', 'gradle.properties', 'gradlew', 'gradlew.bat',
    'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties',
    'app/build.gradle.kts', 'app/proguard-rules.pro', 'app/src/main/AndroidManifest.xml',
    'app/src/main/res/layout/activity_main.xml', 'app/src/main/res/values/strings.xml',
    'app/src/main/res/values/themes.xml', 'app/src/main/res/values/colors.xml',
    'app/src/main/res/drawable/ic_launcher_foreground.xml',
    'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
    'README.md', 'build-apk.bat', '_tools/make-icons.py'
  ].forEach((f) => ok(exists(f), 'A1 存在 ' + f));

  ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].forEach((d) => {
    ok(exists(`app/src/main/res/mipmap-${d}/ic_launcher.png`), 'A2 启动图标 mipmap-' + d);
  });

  /* ---------- B. 包名 / 版本 / SDK ---------- */
  const gradle = read('app/build.gradle.kts');
  ok(/namespace = "com\.stephenhsu\.memorystation"/.test(gradle), 'B1 namespace 正确');
  ok(/applicationId = "com\.stephenhsu\.memorystation"/.test(gradle), 'B2 applicationId 正确');
  ok(/minSdk = 24/.test(gradle), 'B3 minSdk = 24（Android 7.0+）');
  ok(/targetSdk = 35/.test(gradle), 'B4 targetSdk = 35');
  ok(/compileSdk = 35/.test(gradle), 'B5 compileSdk = 35');
  ok(/buildToolsVersion = "35\.0\.0"/.test(gradle), 'B5b 显式指定 buildToolsVersion（避免 AGP 去网上找 34）');
  ok(/buildConfig = true/.test(gradle), 'B5c 开启 buildConfig（MainActivity 用到）');
  ok(/android\.builder\.sdkDownload=false/.test(read('gradle.properties')), 'B5d 关闭 SDK 自动下载（国内网络不卡死）');
  ok(/mirrors\.cloud\.tencent\.com|aliyun/.test(read('settings.gradle.kts')), 'B5e 依赖走国内镜像');

  const meta = fs.readFileSync(path.join(ROOT, 'js/meta.js'), 'utf8');
  const webVer = (meta.match(/version: '([^']+)'/) || [])[1];
  const appVer = (gradle.match(/versionName = "([^"]+)"/) || [])[1];
  ok(!!webVer && webVer === appVer, 'B6 App 版本号与网页版一致', 'web ' + webVer + ' / app ' + appVer);
  ok(/versionCode = \d+/.test(gradle), 'B7 versionCode 存在');

  const wrap = read('gradle/wrapper/gradle-wrapper.properties');
  ok(/gradle-8\.\d+-bin\.zip/.test(wrap), 'B8 Gradle Wrapper 指向 8.x 发行包');

  /* ---------- C. 入口地址 ---------- */
  const strings = read('app/src/main/res/values/strings.xml');
  ok(/memory-station\.app\.workbuddy\.host/.test(strings), 'C1 入口是正式站地址');
  ok(/sharecode=SOZRWWMXJ6/.test(strings), 'C2 带分享码（否则打不开）');
  ok(/app_name">记忆小站</.test(strings), 'C3 应用名是「记忆小站」');

  /* ---------- D. Manifest 权限与入口 ---------- */
  const manifest = read('app/src/main/AndroidManifest.xml');
  ok(/android\.permission\.INTERNET/.test(manifest), 'D1 有 INTERNET 权限');
  ok(/android\.permission\.ACCESS_NETWORK_STATE/.test(manifest), 'D2 有网络状态权限');
  const badPerms = ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'CAMERA', 'RECORD_AUDIO',
    'ACCESS_FINE_LOCATION', 'READ_CONTACTS', 'CALL_PHONE', 'READ_SMS', 'MANAGE_EXTERNAL_STORAGE'];
  const leaked = badPerms.filter((p) => manifest.indexOf(p) >= 0);
  ok(leaked.length === 0, 'D3 没有申请任何敏感权限', leaked.join(','));
  ok(/android:name="\.MainActivity"/.test(manifest), 'D4 主 Activity 已声明');
  ok(/android.intent.action.MAIN/.test(manifest) && /LAUNCHER/.test(manifest), 'D5 是桌面启动入口');
  ok(/configChanges="[^"]*orientation/.test(manifest), 'D6 旋转不重建（网页不重载）');

  /* ---------- E. WebView 关键设置 ---------- */
  const kt = read('app/src/main/java/com/stephenhsu/memorystation/MainActivity.kt');
  ok(/javaScriptEnabled = true/.test(kt), 'E1 开启 JS');
  ok(/domStorageEnabled = true/.test(kt), 'E2 开启 localStorage（学习存档）');
  ok(/mediaPlaybackRequiresUserGesture = false/.test(kt), 'E3 允许音频自动播放（听写/朗读）');
  ok(/setAcceptCookie\(true\)/.test(kt), 'E4 接受 Cookie（分享码与登录态）');
  ok(/MIXED_CONTENT_NEVER_ALLOW/.test(kt), 'E5 禁止明文混合内容');
  ok(/FLAG_KEEP_SCREEN_ON/.test(kt), 'E6 学习时屏幕常亮');
  ok(/loadUrl\(getString\(R\.string\.site_url\)\)/.test(kt), 'E7 启动即加载入口地址');

  /* ---------- F. 备份导入导出 ---------- */
  ok(/onShowFileChooser/.test(kt), 'F1 支持「导入备份」选文件');
  ok(/addJavascriptInterface\(SaveBridge\(\), "Android"\)/.test(kt), 'F2 有保存文件的 JS 桥');
  ok(/BLOB_DOWNLOAD_PATCH/.test(kt), 'F3 注入了 blob 下载补丁（导出备份）');
  ok(/@JavascriptInterface/.test(kt) && /fun saveFile/.test(kt), 'F4 桥暴露 saveFile 方法');
  ok(/MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/.test(kt), 'F5 Android 10+ 存到系统「下载」目录');

  /* ---------- G. 安卓交互 ---------- */
  ok(/OnBackPressedCallback/.test(kt), 'G1 有返回键处理');
  ok(/moveTaskToBack\(true\)/.test(kt), 'G2 退不出时退桌面而不是杀进程');
  ok(/SwipeRefreshLayout|setOnRefreshListener/.test(kt), 'G3 支持下拉刷新');
  ok(/onReceivedError/.test(kt), 'G4 有断网错误处理');
  ok(/offline\.visibility = View\.VISIBLE/.test(kt), 'G5 断网显示提示页');
  ok(/btnRetry/.test(kt), 'G6 提示页有重试按钮');

  /* ---------- H. 网页 PWA 图标（顺带校验） ---------- */
  ok(fs.existsSync(path.join(ROOT, 'assets/icon-192.png')), 'H1 网页 PWA 图标 192 已生成');
  ok(fs.existsSync(path.join(ROOT, 'assets/icon-512.png')), 'H2 网页 PWA 图标 512 已生成');
  const pwa = fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8');
  ok(/icon-192\.png/.test(pwa) && /icon-512\.png/.test(pwa), 'H3 PWA 清单里引用了 PNG 图标');
  ok(/"purpose": "maskable"/.test(pwa), 'H4 提供了 maskable 图标（安卓桌面裁切）');

  const png = fs.readFileSync(path.join(ROOT, 'assets/icon-512.png'));
  ok(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'H5 icon-512.png 是合法 PNG');

  console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + (pass + fail) + ' 项');
  if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
}

main();
