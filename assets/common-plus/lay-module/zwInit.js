layui.define([ "element", "jquery", "layer","zwUtil","table" ], function(exports) {
	var element = layui.element, $ = layui.$, layer = layui.layer,zwUtil=layui.zwUtil,table=layui.table;
	var headerMenuUrl="menu/header_menu";//顶部菜单URL
	var leftMenuUrl="menu/left_menu";//左侧菜单URL
	var workPositionUrl="position/chose_page"//工作位置URL
	var leftMenuClickUrl="sbr/sbr_com/"//左侧点击菜单
	var defaultSkin=1;
	var $headerMenuData=[];
	var $currHeaderMenuId=0;
	var $currLeftMenuId=0;
	var dlGren = function (data,parentTitle){
		  var dls = '<dl class="layui-nav-child">'; 
		  $.each(data, function (key, val) {
			  if(val.children.length>0){
				 dls += '<dd><a href="javascript:;" class="layui-menu-tips"><i class="'+val.icon+'"></i> <span class="layui-left-nav">'+val.title+'</span></a>';
				 dls += dlGren(val.children,parentTitle+"/"+val.title);
			  }else{
				 dls += '<dd><a href="javascript:;" data-left-title="'+parentTitle+'/'+val.title+'" class="layui-menu-tips" data-one-page="'+leftMenuClickUrl+val.id+'" data-one-page-id="'+val.id+'"><i class="'+val.icon+'"></i> <span class="layui-left-nav">'+val.title+'</span></a>';
			  }
			  dls += '</dd>';
		  });
		  dls +='</dl>';
		 return dls;
	}
	var autoHeaderWidth = function (){
		var modelUlWidth = $('.layui-zw-header').width()-$('.layui-zw-header .layui-logo').width()-$('.layui-zw-header .layui-layout-right').width();
		var modelLiWidth = 87;
		var showModelCount = Math.ceil(modelUlWidth/modelLiWidth);
		return showModelCount;
	}
	var changeHeader = function (){
		var showCount = autoHeaderWidth();
		if($('.zw-header-menu-pc>li').length!=showCount){
			zwInit.headerMenu($headerMenuData,$currHeaderMenuId);
		}
	}
	//默认
	var zwInit = new function(){
		/**
         *  系统配置
         * @param name
         * @returns {{BgColorDefault: number, urlSuffixDefault: boolean}|*}
         */
        this.config = function (name) {
            var config = {
                urlHashLocation: true,   // URL地址hash定位
                urlSuffixDefault: false, // URL后缀
                BgColorDefault: defaultSkin       // 默认皮肤（0开始）
            };

            if (name == undefined) {
                return config;
            } else {
                return config[name];
            }
        };
		/**
		 * 页面初始化构造头部导航及左侧菜单
		 */
		this.init=function(data){
			zwInit.initBgColor();
			zwInit.initDevice();
			zwInit.initPage();
			var locationHref = window.location.href;
            var urlArr = locationHref.split("#/");
            var hashHref ="";
            if (urlArr.length >= 2) {
            	hashHref = urlArr.pop();
            }
            data.href=hashHref;
			 $.ajax({
				  url:headerMenuUrl,
				  type:'get',
				  data:data,
				  dataType:'json',
				  success:function(res){
					  if(res.code==1){
						  var hashId=res.other.id;
						  $headerMenuData=res.data;
						  var defaultId = zwInit.headerMenu(res.data,hashId);//加载顶部菜单，返回需要选中的id
						  $currHeaderMenuId = defaultId;
						  zwInit.leftMenuJSON({parentId:defaultId});
						  if(hashHref!=""){
							  $('.zw-left-menu-pc [data-one-page="'+hashHref+'"]').parent().parent().parent().addClass('layui-nav-itemed');
							  $('.zw-left-menu-pc [data-one-page="'+hashHref+'"]').parent().addClass('layui-this');
						  }
						  $("body>div[class='zw-back']").remove();
					  }
				  }
			  })
		};
		
		/**
         * 初始化主内容
         */
        this.initPage = function () {
            var locationHref = window.location.href;
            var urlArr = locationHref.split("#/");
            if (urlArr.length >= 2) {
                var href = urlArr.pop();
                zwInit.initConten(href);
                //zwInit.initPageTitle(href);
            }else{
            	zwInit.initConten("main"); 
            }
        };
		/**
         * 初始化设备端
         */
        this.initDevice = function () {
            if (zwInit.checkMobile()) {
                $('.layui-layout-body').attr('class', 'layui-layout-body zwsoft-mini');
            }
        };
		
		/**
         * 初始化首页信息
         * @param data
         */
        this.initHome = function (data) {
            var localhostHref = window.location.href;
            if (!localhostHref.match(RegExp(/#/))) {
            	zwInit.initConten(data.href, false);
            }
        };
        
		/**
		 * 获取左侧菜单栏JSON触发构造
		 */
		this.leftMenuJSON=function(data){
			 $.ajax({
				  url:leftMenuUrl,
				  type:'get',
				  async:false,
				  data:data,
				  dataType:'json',
				  success:function(res){
					  if(res.code==1){
						  zwInit.leftMenu(res.data);
					  }
				  }
			  })
		};
		/**
		 * 根据JOSN构造头部导航
		 */
		this.headerMenu = function(data,hashId) {
			var headerMenuHtml = '',
	            headerMenuCheckDefault = '',
	            defaultId=0;
	            if(hashId>0){
	            	 defaultId=hashId;
	            }
	        var showCount = autoHeaderWidth()-1;
	        var i=1;
	        var otherModelLi='<li class="layui-nav-item" style="padding:0 15px;"><a href="javascript:;">其它模块</a><dl class="layui-nav-child">';
	        $.each(data, function (key, val) {
	        	if(val.id==defaultId){
	        		 headerMenuCheckDefault = 'layui-this';
	        	}else{
	        		headerMenuCheckDefault = '';
	        	}
        		if(val.childrenCount>0){
        			if(i>showCount){
	    				otherModelLi+='<dd data-header-menu="'+val.id+'" class="'+headerMenuCheckDefault+'"><a href="javascript:;"><i class="'+val.icon+'"></i>&nbsp;&nbsp;&nbsp;<span>'+val.title+'</span></a></dd>';
        			}else{
        				headerMenuHtml += '<li class="layui-nav-item '+headerMenuCheckDefault+'" data-header-menu="'+val.id+'" ><a href="javascript:;"><i class="'+val.icon+'"></i><span class="zw-header-text">'+val.title+'</span></a></li>';
        			}
	        	}else{
	        		if(i>showCount){
	    				otherModelLi+='<dd  class="'+headerMenuCheckDefault+'" data-one-page="'+val.href+'" target="_blank"><a href="javascript:;"><i class="'+val.icon+'"></i>&nbsp;&nbsp;&nbsp;<span>'+val.title+'</span></a></dd>';
        			}else{
        				headerMenuHtml += '<li class="layui-nav-item '+headerMenuCheckDefault+'" data-one-page="'+val.href+'" target="_blank"><a href="javascript:;"><i class="'+val.icon+'"></i><span class="zw-header-text">'+val.title+'</span></a></li>';
        			}
	        		
	        	}
	        	i++;
	        });
	        otherModelLi+='</dl></li>';
	        if(data.length>=showCount+1){
	        	headerMenuHtml+=otherModelLi;
	        }
	        $('.zw-header-menu-pc').html(headerMenuHtml); //电脑
	        element.init();
	        return defaultId;
		};
		/**
		 * 根据JSON构造左侧菜单
		 */
		this.leftMenu = function(data) {
			var lis = '';
			$.each(data, function (key, val) {
				if(val.children.length>0){
					var c ="";
					if($currLeftMenuId!=0){
						for(var i=0;i<val.children.length;i++){
							if($currLeftMenuId==val.children[i].id){
								c = "layui-nav-itemed";
							}
						}
					}else{
						if(key==0){
							c = "layui-nav-itemed";
						}
					}
					lis += '<li class="layui-nav-item '+c+'"><a class="layui-menu-tips"><i class="'+val.icon+'"></i> <span class="layui-left-nav">'+val.title+'</span></a>';
					lis += dlGren(val.children,val.title);
				}else{
					lis += '<li class="layui-nav-item "><a class="layui-menu-tips" data-one-page="'+leftMenuClickUrl+val.id+'" data-one-page-id="'+val.id+'"><i class="'+val.icon+'"></i> <span class="layui-left-nav">'+val.title+'</span></a>';
				}
				lis += '</li>';
			});
			if(data.length>0){
				$(".layui-layout-body").removeClass("layui-zw-max-body");
			}else{//左侧菜单无子节点
				//layer.msg('没有子菜单', {icon: 2});
				$(".layui-layout-body").addClass("layui-zw-max-body");
			}
			$('.zw-left-menu-pc').html(lis);
			element.render();
		};
		/**
         * 监听hash地址变化
         */
        this.listen = function () {
            if (window.zwkjyLoadLocalPage) {
                return;
            }
            window.onhashchange = function (hash) {
	try{
			oWebControl.JS_DestroyWnd();
		}catch(e){
		}
                var locationHref = window.location.href;
                var urlArr = locationHref.split("#/");
                if (urlArr.length >= 2) {
                    var href = urlArr.pop();
                    zwInit.initConten(href);
                } else {
                    zwInit.initConten("main");
                }
            };
        };
		/**
         * 初始化内容信息
         * @param container
         * @param href
         * @param isHash
         */
        this.initConten = function (href, isHash) {
            if (window.zwkjyLoadLocalPage) {
                window.zwkjyLoadLocalPage(href, { force: true });
                return;
            }
            var container = '.lay-zw-content-page';
            $.ajax({
    			url : workPositionUrl,
    			data:{href:href,"timestamp":new Date().getTime()},
    			success : function(result) {
    				$(".workPositionDiv").html(result);
    			}
    		});
            var v = new Date().getTime();
            $(container).html('');
            $.ajax({
                url: href.indexOf("?") > -1 ? href + '&v=' + v : href + '?v=' + v,
                type: 'get',
                dataType: 'html',
                success: function (data) {
                    $(container).html(data);
                },
                error: function (xhr, textstatus, thrown) {
                   $(container).html('<div style="margin:12px;padding:16px;background:#fff;border:1px solid #fecaca;color:#b91c1c;">页面加载失败：' + href + '，状态：' + xhr.status + '</div>');
                }
            });
        };
		/**
         * 判断是否为手机
         */
        this.checkMobile = function () {
            var ua = navigator.userAgent.toLocaleLowerCase();
            var pf = navigator.platform.toLocaleLowerCase();
            var isAndroid = (/android/i).test(ua) || ((/iPhone|iPod|iPad/i).test(ua) && (/linux/i).test(pf))
                || (/ucweb.*linux/i.test(ua));
            var isIOS = (/iPhone|iPod|iPad/i).test(ua) && !isAndroid;
            var isWinPhone = (/Windows Phone|ZuneWP7/i).test(ua);
            var clientWidth = document.documentElement.clientWidth;
            if (!isAndroid && !isIOS && !isWinPhone && clientWidth > 768) {
                return false;
            } else {
                return true;
            }
        };
        /**
         * hash地址定位
         * @param href
         */
        this.hash = function (href) {
            window.location.hash = "/" + href;
        };
        /**
         * 成功
         * @param title
         * @returns {*}
         */
        this.msg_success = function (title) {
            return layer.msg(title, {icon: 1, shade: this.shade, scrollbar: false, time: 2000, shadeClose: true});
        };

        /**
         * 失败
         * @param title
         * @returns {*}
         */
        this.msg_error = function (title) {
            return layer.msg(title, {icon: 2, shade: this.shade, scrollbar: false, time: 3000, shadeClose: true});
        };
        
        /**
         * 配色方案配置项(默认选中第一个方案)
         * @param bgcolorId
         */
        this.bgColorConfig = function (bgcolorId) {
            var bgColorConfig = [
                {
                    headerRight: '#1aa094',
                    headerFontRight: '#ffffff',
                    headerRightThis: '#197971',
                    headerLogo: '#1aa094',
                    headerLogoFont:'#f9f9f9',
                    menuLeft: '#2f4056',
                    menuLeftChild: '#212d3c',
                    menuLeftFont: '#f9f9f9',
                    menuLeftThis: '#197971',
                    menuLeftThisFont: '#f9f9f9',
                    menuLeftHover: '#3b3f4b',
                },
                {
                    headerRight: '#3c8dbc',
                    headerFontRight: '#ffffff',
                    headerRightThis: '#367fa9',
                    headerLogo: '#3c8dbc',
                    headerLogoFont:'#fff',
                    menuLeft: '#f9fafc',
                    menuLeftChild: '#f4f4f5',
                    menuLeftFont: '#777777',
                    menuLeftThis: '#3c8dbc',
                    menuLeftThisFont: '#ffffff',
                    menuLeftHover: '#3c8dbc',
                },
                {
                    headerRight: '#393D49',
                    headerFontRight: '#ffffff',
                    headerRightThis: '#197971',
                    headerLogo: '#393D49',
                    headerLogoFont:'#f9f9f9',
                    menuLeft: '#f9fafc',
                    menuLeftChild: '#f4f4f5',
                    menuLeftFont: '#777777',
                    menuLeftThis: '#197971',
                    menuLeftThisFont: '#ffffff',
                    menuLeftHover: '#212d3c',
                },
                {
                    headerRight: '#1aa094',
                    headerFontRight: '#ffffff',
                    headerRightThis: '#197971',
                    headerLogo: '#1aa094',
                    headerLogoFont:'#f9f9f9',
                    menuLeft: '#f9fafc',
                    menuLeftChild: '#f4f4f5',
                    menuLeftFont: '#777777',
                    menuLeftThis: '#1aa094',
                    menuLeftThisFont: '#f9f9f9',
                    menuLeftHover: '#197971',
                },{
                    headerRight: '#3c8dbc',
                    headerFontRight: '#ffffff',
                    headerRightThis: '#367fa9',
                    headerLogo: '#3c8dbc',
                    headerLogoFont:'#f9f9f9',
                    menuLeft: '#2f4056',
                    menuLeftChild: '#212d3c',
                    menuLeftFont: '#f9f9f9',
                    menuLeftThis: '#3c8dbc',
                    menuLeftThisFont: '#f9f9f9',
                    menuLeftHover: '#3c8dbc',
                },{
                    headerRight: '#393D49',
                    headerFontRight: '#ffffff',
                    headerRightThis: '#197971',
                    headerLogo: '#393D49',
                    headerLogoFont:'#f9f9f9',
                    menuLeft: '#393D49',
                    menuLeftChild: '#393D49',
                    menuLeftFont: '#f9f9f9',
                    menuLeftThis: '#197971',
                    menuLeftThisFont: '#f9f9f9',
                    menuLeftHover: '#197971',
                },{
                    headerRight: '#3c8dbc',
                    headerRightThis: '#367fa9',
                    headerLogo: '#3c8dbc',
                    headerLogoFont:'#fff',
                    menuLeft: '#f9fafc',
                    menuLeftChild: '#f4f4f5',
                    menuLeftFont: '#777777',
                    menuLeftThis: '#3c8dbc',
                    menuLeftThisFont: '#ffffff',
                    menuLeftHover: '#3c8dbc',
                }
            ];

            if (bgcolorId == undefined) {
                return bgColorConfig;
            } else {
                return bgColorConfig[bgcolorId];
            }
        };
        
        /**
         * 初始化背景色
         */
        this.initBgColor = function () {
            var bgcolorId = sessionStorage.getItem('zwsoftBgcolorId');
            if (bgcolorId == null || bgcolorId == undefined || bgcolorId == '') {
                bgcolorId = zwInit.config('BgColorDefault');
            }
            var bgcolorData = zwInit.bgColorConfig(bgcolorId);
            var styleHtml = '.layui-layout-admin .layui-header{background-color:' + bgcolorData.headerRight + '!important;}\n' +
                '.layui-header>ul>.layui-nav-item.layui-this,.layuimini-tool i:hover{background-color:' + bgcolorData.headerRightThis + '!important;}\n' +
                '.layui-layout-admin .layui-logo ,.layui-logo-mini{background-color:' + bgcolorData.headerLogo + '; color:'+bgcolorData.headerLogoFont+'}\n' +
                '.layui-side.layui-bg-black,.layui-side.layui-bg-black>.layui-left-menu>ul,.zw-left-menu-pc {background-color:' + bgcolorData.menuLeft + '!important;}\n' +
                '.layui-left-menu .layui-nav .layui-nav-child a:hover:not(.layui-this) {background-color:' + bgcolorData.menuLeftHover + ';}\n' +
                '.layui-layout-admin .layui-nav-tree .layui-this, .layui-layout-admin .layui-nav-tree .layui-this>a, .layui-layout-admin .layui-nav-tree .layui-nav-child dd.layui-this, .layui-layout-admin .layui-nav-tree .layui-nav-child dd.layui-this a {\n' +
                'background-color: ' + bgcolorData.menuLeftThis + ' !important; color:'+bgcolorData.menuLeftThisFont+'!important;\n' +
                '}.layui-nav-tree .layui-nav-bar{background-color:' + bgcolorData.menuLeftHover + ';}\n';
            styleHtml +='.layui-nav-itemed > .layui-nav-child{background-color: '+bgcolorData.menuLeftChild+' !important;}\n';
            styleHtml +='.layui-nav-tree .layui-nav-child a{color: '+bgcolorData.menuLeftFont+' !important;}\n';
            styleHtml +='.zwsoft-tool:hover i{color: '+bgcolorData.menuLeftThis+' !important;}\n';
            styleHtml +='.zwsoft-tool{color: '+bgcolorData.menuLeftFont+' !important;}\n';
            styleHtml +='.zw-left-menu-pc .layui-nav-itemed > a{color: '+bgcolorData.menuLeftFont+' !important;}\n';
            styleHtml +='.zw-left-menu-pc .layui-nav-item a{color: '+bgcolorData.menuLeftFont+' !important;}\n';
            styleHtml +='.zw-left-menu-pc .layui-nav-more{  border-top-color: '+bgcolorData.menuLeftFont+' !important;}\n';
            styleHtml +='.zw-left-menu-pc .layui-nav-itemed .layui-nav-more{  border-top-color: '+bgcolorData.menuLeft+' !important;}\n';
            styleHtml +='.zw-left-menu-pc .layui-nav-mored, .layui-nav-itemed > a .layui-nav-more{border-color: transparent transparent '+bgcolorData.menuLeftFont+';}\n';
            styleHtml +='.layui-nav-tree .layui-nav-item a:hover{background-color: '+bgcolorData.menuLeftChild+' !important;color:'+bgcolorData.menuLeftFont+' !important;}\n';
            styleHtml +='.layui-nav .layui-nav-child dd.layui-this a, .layui-nav-child dd.layui-this{background-color: '+bgcolorData.headerRightThis+' !important;}\n';
            styleHtml +='.socket .hex-brick{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.btn-primary{background-color: '+bgcolorData.headerRight+'!important;border-color:'+bgcolorData.headerRight+'}\n';
            styleHtml +='.layui-laypage .layui-laypage-curr .layui-laypage-em{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.btn-primary:hover{background-color: '+bgcolorData.headerRightThis+'!important;border-color:'+bgcolorData.headerRightThis+'}\n';
            styleHtml +='@keyframes fade{0%{background: '+bgcolorData.headerRight+'!important;} \n 50%{background: '+bgcolorData.headerRightThis+'!important;} \n 100%{background: '+bgcolorData.headerRight+'!important;}\n}\n';
            //table
            styleHtml +='.table .selected{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.zw-refresh-back>i{color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.select2-container--default .select2-results__option--highlighted[aria-selected]{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.zw-online-model .layui-tab-brief > .layui-tab-more li.layui-this::after, .layui-tab-brief > .layui-tab-title .layui-this::after{border-bottom: 2px solid '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.zw-online-model .list-group-item:hover{border-left: 5px solid '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.blink{color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='::selection{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.layout-zw-model .layui-layer-content{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.layui-tab-card > .layui-tab-title .layui-this{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.layui-tab-card > .layui-tab-more .layui-this{background-color: '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.zw-table-input{border: 1px solid '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.panel-info > .panel-heading{background-color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.sxTabTitle>p:hover{background-color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.sxTabTitle .sxtab-active{background-color:'+bgcolorData.headerRightThis+'!important;}\n';
            styleHtml +='.personalCenter{background-color:'+bgcolorData.headerRight+'!important;color:#f5f5f5}\n';
            styleHtml +='.nav-tabs-custom > .nav-tabs > li.active{border-top-color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.dhxtree_material .selectedTreeRowFull .dhxTextCell,.selectedTreeRow{color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.pagination > .active > a, .pagination > .active > span, .pagination > .active > a:hover, .pagination > .active > span:hover, .pagination > .active > a:focus, .pagination > .active > span:focus{background-color:'+bgcolorData.headerRight+'!important;border-color:'+bgcolorData.headerRight+'}\n';
            //layui
            styleHtml +='.layui-table-edit:focus,.layui-zw-model-edit .layui-layer-content{border: 1px solid '+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.layui-table-click,.layui-zw-model-edit .layui-layer-title,.nav-tabs > li > a:hover,.zw-modal-header{background-color:'+bgcolorData.headerRight+'!important;color:#f9f9f9!important;}\n';
            styleHtml +='.layui-form-checkbox[lay-skin="primary"]:hover i,.layui-btn-primary:hover{border-color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.layui-form-checked[lay-skin="primary"] i{background-color:'+bgcolorData.headerRight+'!important; border-color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.layui-table-hover .layui-form-radio > i,.layui-zw-model-edit-text .layui-layer-title{color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.nav-tabs > .active > a:hover{background-color:#ffffff!important;color:#444444!important;}\n';
            styleHtml +='.zw-footer a{color:'+bgcolorData.menuLeftFont+'!important;}\n';
            styleHtml +='.layui-form-radioed > i{color:'+bgcolorData.headerRight+'!important;}\n';
            styleHtml +='.layui-btn {background-color:'+bgcolorData.headerRight+'}\n';
            if(bgcolorData.headerFontRight){
            	 styleHtml +='.zw-header-menu-pc>li>a{color:'+bgcolorData.headerFontRight+'!important;}\n';
            }
            if(bgcolorId==6){
            	 styleHtml +='.layui-side.layui-bg-black{background:url(assets/common-plus/img/bg/sin.jpg) no-repeat !important;background-size：contain;}\n';
                 styleHtml +='.layui-side.layui-bg-black > .layui-left-menu > ul, .zw-left-menu-pc,.layui-nav-itemed > .layui-nav-child{background-color:transparent !important;}\n';
            }
            $('#layui-zw-bg-color').html(styleHtml);
        };
        /**
         * 构建背景颜色选择
         * @returns {string}
         */
        this.buildBgColorHtml = function () {
            var html = '';
            var bgcolorId = sessionStorage.getItem('zwsoftBgcolorId');
            if (bgcolorId == null || bgcolorId == undefined || bgcolorId == '') {
            	bgcolorId = zwInit.config('BgColorDefault');
            }
            var bgColorConfig = zwInit.bgColorConfig();
            $.each(bgColorConfig, function (key, val) {
                if (key == bgcolorId) {
                    html += '<li class="layui-this" data-select-bgcolor="' + key + '">\n';
                } else {
                    html += '<li  data-select-bgcolor="' + key + '">\n';
                }
                html += '<a href="javascript:;" data-skin="skin-blue" style="" class="clearfix full-opacity-hover">\n' +
                    '<div><span style="display:block; width: 20%; float: left; height: 12px; background: ' + val.headerLogo + ';"></span><span style="display:block; width: 80%; float: left; height: 12px; background: ' + val.headerRight + ';"></span></div>\n' +
                    '<div><span style="display:block; width: 20%; float: left; height: 40px; background: ' + val.menuLeft + ';"></span><span style="display:block; width: 80%; float: left; height: 40px; background: #f4f5f7;"></span></div>\n' +
                    '</a>\n' +
                    '</li>';
            });
            return html;
        };
        /**
         * 刷新事件
         */
        this.refresh = function () {
            var locationHref = window.location.href;
            var urlArr = locationHref.split("#/");
            if (urlArr.length >= 2) {
                var href = urlArr.pop();
                zwInit.initConten(href);
            }
        };
        /**
         * 切换用户或者重新登录
         */
        this.loginMini = function(closeBtn,title){
        	$.ajax({
				url : "common/login-mini.html",
				success : function(result) {
					layer.open({
		    			  type: 1,
		    			  title:title,
		    			  id:'loginMiniModel',
		    			  closeBtn: closeBtn,
		    			  anim: 1,
		    			  move:false,
		    			  shade: [0.5, '#000000'],
		    			  fixed: true,
		    			  resize:false,
		    			  content: result
		    		});
				}
			});
        };
        /**
         * 保留小数位数
         */
        this.retainDecimalPlaces=function(value,decimal){
        	var numStr = value.toString();
			var num = parseFloat(value);
			if(numStr.indexOf(".") >= 0){
				var str = numStr.split(".");
				if(str[1].length > decimal){
					return num.toFixed(decimal);
				}
			}
			return value;
        }
	}
	/**
	 * 监听头部导航点击事件
	 */
	$('body').on('click','[data-header-menu]',function(){
		var loading = layer.load(0, {shade: false, time: 2 * 1000});
		try{
			oWebControl.JS_DestroyWnd();
		}catch(e){
		}
		$currHeaderMenuId=$(this).attr("data-header-menu");
		$currLeftMenuId=0;
		zwInit.leftMenuJSON({parentId:$currHeaderMenuId});
		zwInit.initConten("sbr/header_content?headerMenuId="+$currHeaderMenuId);
		layer.close(loading);
	})
	/**
	 * 左侧点击事件
	 */
	$('body').on('click','[data-one-page]',function() {
		var loading = layer.load(0, {shade : false,time : 2 * 1000});
		$currLeftMenuId=$(this).attr('data-one-page-id');
		var href = $(this).attr('data-one-page'), target = $(this).attr('target');
		if (target == '_blank') {
			if(href=="http://121.43.178.64:26974/localsense"){//先暂时这么写
				$.ajax({
					url : href+'/SingleModule?username=admin&password=ca2924d86691a890bd96ad5e11620c4a#/app/WebMap',
					type : 'get',
					dataType : 'jsonp',
					async:false,
					error:function(){
						window.open(href);
					}
				});
				return false;
			}
			changeHeader();
			layer.close(loading);
			window.open(href, "_blank");
			return false;
		}
		try{
			oWebControl.JS_DestroyWnd();
		}catch(e){
		}
		if($(this).parent().attr("class")=="layui-this"){//当选中左侧菜单的时候 重复点击时刷新
       	 var locationHref = window.location.href;
            var urlArr = locationHref.split("#/");
            if (urlArr.length >= 2) {
                var href2 = urlArr.pop();
                if(href2==href){
                	zwInit.refresh(); 
                }
            }
       }
		zwInit.hash(href);
		layer.close(loading);
	});
	/**
     * 刷新
     */
    $('body').on('click', '[data-refresh]', function () {
        var loading = layer.load(0, {shade: false, time: 2 * 1000});
        zwInit.refresh();
        layer.close(loading);
        zwInit.msg_success('刷新成功');
    });
    /**
     * 选择配色方案
     */
    $('body').on('click', '[data-select-bgcolor]', function () {
        var bgcolorId = $(this).attr('data-select-bgcolor');
        $('.zwsoft-bg-color .color-content ul .layui-this').attr('class', '');
        $(this).attr('class', 'layui-this');
        sessionStorage.setItem('zwsoftBgcolorId', bgcolorId);
        zwInit.initBgColor();
    });
    /**
     * 注销
     */
    $('body').on('click', '[data-user-layout]', function () {
    	//询问框
    	layer.confirm('确认是否注销？', {
    	  title:'提示',
    	  btn: ['确认','取消'] //按钮
    	}, function(){
    		$.ajax({
        		url : "loginout",
        		type : "get",
        		success : function(result) {
        			if (result.code == 1) {
        				window.location.reload();
        			} else {
        				layer.msg(result.msg, {icon: 2});
        			}
        		}
        	})
    	});
    	$(this).parent().removeClass('layui-this');
    });
    /**
     * 基本资料
     */
    $('body').on('click', '[data-user-base]', function () {
    		Ewin.modal({
    		  	modalId:"personalCenterIndexEdit",
    			title:"个人中心",
    			url:"user/personal_center",
    			headerClass:"zw-modal-header",
    			top:100,
    			drag:true,
    			data:{
    				userId:$currUserId
    			}
    		});
    		$(this).parent().removeClass('layui-this');
    });
    /**
     * 切换用户
     */
    $('body').on('click', '[data-switch-user]', function () {
    	zwInit.loginMini(1,'切换用户');
    	$(this).parent().removeClass('layui-this');
    });
    layui.$.ajaxSetup({
        complete : function(xhr, status) {
            if (xhr.status == 401) {// 系统登录过期
                //zwInit.loginMini(0,'登录失效，请重新登录');
                //页面层
                window.location.reload();
            }else if(xhr.status == 404){// 请求不存在
                zwInit.msg_error('状态:' + xhr.status + '，请求不存在！');
            }else if(xhr.status == 405){// 没有方法权限
                var JsonObject = JSON.parse(xhr.responseText);
                $.ajax({
                    url : "error_page/no_jurisdiction",
                    data:{"message":JsonObject.msg},
                    success : function(result) {
                        zwInit.msg_error('状态:' + xhr.status + '，' + result + '！');
                    }
                });
            }else if(xhr.status == 500){// 服务器内部异常
                var fixedResponse = xhr.responseText.replace(/\\'/g, "'");
                var jsonObj = JSON.parse(fixedResponse);
				console.log(jsonObj);
//                zwInit.msg_error('状态:' + xhr.status + '，' + xhr.statusText + '，请稍后再试！');
//    					$.ajax({
//    	    				url : "error_page/server_error",
//    	    				data:{"message":jsonObj.message},
//    	    				success : function(result) {	}
//    					});
            }else if(xhr.status == 0){
                //window.location.reload();// 失去网络后刷新当前页面
            }
        }
    });
    /**
     * 公告管理
     */
    $('body').on('click','#gonggaoMeassgeIndex',function(){
		layer.open({
				  type: 1,
				  offset: 'lb',
			  area: ['198px','350px'],
			  shade: 0,
			  move: false,
			  closeBtn:2,
			  anim: 2,
			  title: '<i class="glyphicon glyphicon-bullhorn"></i> 公告信息  <span class="label label-success" data-id="gonggaoMessageCountId">'+$(this).find("span").text()+"</span>",
			  content: '<table id="partGroupMeetingIndexList" lay-filter="partGroupMeetingIndexList"></table>',
			  success: function(layero, index){
				  var cols = [
						{"title": "序号","type":"numbers","fixed":"left"},
			          	{"title": "公告名称（双击查看）","field":"partTitle","align":"left"}
			          //,{"title": "发起时间","field":"partDate"}
			        ];
					table.render({
					    elem: '#partGroupMeetingIndexList'
					    ,url: 'party_group_metting/findPartGroupMeetingIndexList' //数据接口
					  	,cellMinWidth: 80
					  	,height: 295
					  	,even:true
					    ,cols: [cols]
					    ,size: 'sm'
					    ,skin:'line'
					});
					table.on('rowDouble(partGroupMeetingIndexList)', function(obj){
				      var data = obj.data;
				      obj.tr.addClass('layui-table-click').siblings().removeClass('layui-table-click');
				      var partId=data.partId;
		    			$.ajax({
		    				url : "main_controller/getWorkPositionPageTest",
		    				data : {
		    					"refType" : 0,
		    				},
		    				success : function(result) {
		    					$(".workPositionDiv").html(result);
		    					/* 加载内容 -START */
		    					contentAjax = $.ajax({
		    						url : "party_group_metting/browsPartyGroupMettingPage",
		    						data : {
		    							partId:partId,
		    							type:"gg"
		    						},
		    						success : function(result) {
		    							$(".lay-zw-content-page").html(result);
		    						}
		    					});
		    				}
		    			});
					});
			  }
		});
	});
    /**
     * 显示app下载二维码
     */
    $('body').on('click','[data-img-qrcode]', function(){
    	var layuierDiv = '<div class="fatherDiv" style="height:360px;"><div class="sonDiv"><img width="300" height="300" src="img/qrCode.png"></div></div><br/><p style=" text-align: center;">使用微信或浏览器扫码即可下载APP</p>';
    	layer.open({
	        type: 1
	        ,title: false //不显示标题栏
	        ,closeBtn: false
	        ,area: '360px;'
	        ,shade: 0.8
	        ,id: 'layerDivQrCodeScan' //设定一个id，防止重复弹出
	        ,btn: ['操作说明','暂不下载']
	        ,btnAlign: 'c'
	        ,moveType: 1 //拖拽模式，0或者1
	        ,content: layuierDiv
	        ,yes: function(index, layero){
	            //按钮【按钮一】的回调 
				layer.open({
					  type: 2,
					  title: false,
					  closeBtn: true,
					  area: ['280px', '575px'],
					  shade: 0.1,
					  closeBtn: 0,
					  shadeClose: true,
					  offset: ['l','200px'],
					  content:["https://zwsoft-1257476422.cos.ap-chengdu.myqcloud.com/assets/image/instructions.gif", 'no']
					});
	          }
	    });
	});
    $('body').on('click','[data-zw-main]', function(){
    	window.location.href="/index";
    });
    /**
     * 监听左侧菜单栏缩进/展开  
     */
    $('body').on('click','[data-zwsoft-indent]', function(){
    	if($(".zwsoft-mini").length>0){
    		$(".layui-layout-body").attr("class","layui-layout-body");
    		$(this).attr("data-zwsoft-indent","1");
    		$(this).children("i").attr("class","fa fa-dedent");
    	}else{
    		$(".layui-layout-body").attr("class","layui-layout-body zwsoft-mini");
    		$(this).attr("data-zwsoft-indent","0");
    		$(this).children("i").attr("class","fa fa-indent");
    	}
	});
    $('body').on('click','.zwsoft-select-bgcolor', function(){
    	var loading = layer.load(0, {shade: false, time: 2 * 1000});
        var clientHeight = (document.documentElement.clientHeight) - 95;
        var bgColorHtml = zwInit.buildBgColorHtml();
        var html = '<div class="zwsoft-bg-color">\n' +
            '<div class="color-title">\n' +
            '<span><i class="layui-icon layui-icon-layouts"></i> 主题切换</span>\n' +
            '</div>\n' +
            '<div class="color-content">\n' +
            '<ul>\n' + bgColorHtml + '</ul>\n' +
            '</div>\n' +
            '</div>';
        layer.open({
            type: 1,
            title: false,
            closeBtn: 0,
            shade: 0.2,
            anim: 2,
            shadeClose: true,
            id: 'zwsoftBgColor',
            area: ['340px', clientHeight + 'px'],
            offset: 'rb',
            content: html,
            end: function () {
                $('.zwsoft-select-bgcolor').removeClass('layui-this');
            }
        });
        layer.close(loading);
    });
    /**
     * 监听提示信息
     */
    $("body").on("mouseenter", ".layui-menu-tips", function () {
        var classInfo = $(this).attr('class'),
            tips = $(this).children('span').text(),
            isShow = $('[data-zwsoft-indent]').attr('data-zwsoft-indent');
        if (isShow == 0) {
            openTips = layer.tips(tips, $(this), {tips: [2, '#2f4056'], time: 30000});
        }
    });
    $("body").on("mouseleave", ".layui-menu-tips", function () {
        var isShow = $('[data-zwsoft-indent]').attr('data-zwsoft-indent');
        if (isShow == 0) {
            try {
                layer.close(openTips);
            } catch (e) {
                console.log(e.message);
            }
        }
    });
    /**
     * 监听窗口变化
     */
    window.onresize = function () {
    	changeHeader();
    }
	exports('zwInit', zwInit);
});
