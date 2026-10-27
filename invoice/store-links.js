// Gắn campaign vào nút tải app để biết người dùng tới từ trang nào (App Store Connect › App Analytics › Campaigns;
// Play Console › Store analysis › nguồn có UTM). Không cookie, không gửi gì đi đâu.
//
// Campaign = ?ct=… trên URL (ví dụ link từ Reddit: /invoice/?ct=reddit-freelance) hoặc <meta name="campaign">
// của trang (trang SEO tự đặt), mặc định "landing". HTML đã có href đầy đủ nên tắt JS vẫn tải được app.
(function () {
  var APPLE_ID = "6825215204";
  var PLAY_ID = "com.minh.invoice";
  // Provider token của tài khoản Apple (ASC › App Analytics › tạo campaign link sẽ thấy pt=…). Để trống thì
  // App Store vẫn ghi nguồn "Web referrer" theo tên miền, chỉ không tách được theo campaign.
  var APPLE_PT = "";

  var params = new URLSearchParams(location.search);
  var meta = document.querySelector('meta[name="campaign"]');
  var raw = params.get("ct") || (meta && meta.content) || "landing";
  var ct = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);

  var apple = "https://apps.apple.com/app/apple-store/id" + APPLE_ID + "?mt=8&ct=" + encodeURIComponent(ct) +
    (APPLE_PT ? "&pt=" + encodeURIComponent(APPLE_PT) : "");
  var referrer = "utm_source=" + encodeURIComponent(ct) + "&utm_medium=web&utm_campaign=" + encodeURIComponent(ct);
  var play = "https://play.google.com/store/apps/details?id=" + PLAY_ID + "&referrer=" + encodeURIComponent(referrer);

  document.querySelectorAll('a[data-store="ios"]').forEach(function (a) { a.href = apple; });
  document.querySelectorAll('a[data-store="android"]').forEach(function (a) { a.href = play; });
})();
