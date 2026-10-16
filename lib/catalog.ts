export const characters=[
 {id:'limo',name:'Limo',emoji:'🍋',tone:'Friendly · energetic · educational',tier:'standard'},
 {id:'nova',name:'Nova',emoji:'✨',tone:'Modern · confident · concise',tier:'standard'},
 {id:'adam',name:'Adam',emoji:'🧑‍💼',tone:'Professional · clear · trustworthy',tier:'standard'}
] as const;
export const languages=[
 {code:'ar',label:'Arabic',native:'العربية'},
 {code:'fr',label:'French',native:'Français'},
 {code:'en',label:'English',native:'English'},
 {code:'de',label:'German',native:'Deutsch'}
] as const;
export const platforms=[
 {id:'facebook',name:'Facebook',icon:'f',enabled:true},
 {id:'instagram',name:'Instagram',icon:'◎',enabled:false},
 {id:'tiktok',name:'TikTok',icon:'♪',enabled:false},
 {id:'youtube',name:'YouTube',icon:'▶',enabled:false},
 {id:'linkedin',name:'LinkedIn',icon:'in',enabled:false},
 {id:'x',name:'X',icon:'𝕏',enabled:false},
 {id:'snapchat',name:'Snapchat',icon:'◉',enabled:false},
 {id:'threads',name:'Threads',icon:'@',enabled:false}
] as const;
export const plans=[
 {code:'starter',name:'Starter',monthlyDzd:5900,redotpayUsdt:23,videoSlots:6,posts:30,facebookPages:1,aiImages:10},
 {code:'creator',name:'Creator',monthlyDzd:12900,redotpayUsdt:50,videoSlots:15,posts:90,facebookPages:3,aiImages:30},
 {code:'business',name:'Business',monthlyDzd:24900,redotpayUsdt:95,videoSlots:30,posts:250,facebookPages:10,aiImages:80}
] as const;
export const addons=[
 {code:'video_1',name:'+1 video slot',dzd:800,usdt:3.2,resource:'video',units:1},
 {code:'video_5',name:'+5 video slots',dzd:3500,usdt:13.5,resource:'video',units:5},
 {code:'video_10',name:'+10 video slots',dzd:6500,usdt:25,resource:'video',units:10},
 {code:'posts_25',name:'+25 posts',dzd:900,usdt:3.5,resource:'post',units:25},
 {code:'facebook_page_1',name:'+1 Facebook page',dzd:1500,usdt:6,resource:'facebook_page',units:1}
] as const;
