// Original brand assets from the official platform websites; see ../../brands/SOURCES.md.
const marks = Object.freeze({
  douyin: ['douyin.ico', '抖音'], wechat_channels: ['wechat_channels.ico', '视频号'],
  xiaohongshu: ['xiaohongshu.png', '小红书'], weibo: ['weibo.ico', '微博']
});
export function platformMark(codeOrName) {
  const entry = marks[codeOrName] || Object.values(marks).find(([,name]) => name === codeOrName);
  return entry ? `<img class="platform-mark" src="/assets/brands/${entry[0]}" alt="${entry[1]}" width="24" height="24">` : '';
}
