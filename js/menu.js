/**此js处理菜单加载-点击事件*/
var ZWMENU={
		/*改变顶部伸缩事件*/
		changeTopEven:function(){
			var activeId = $(".zw-nav li[class*='active']").children("a").attr("data-id");
			var html = $(".zw-nav").html();
			$(".zw-nav").empty();
			var children = $(".zw-nav").parent().find("#topmenu-temp-hide").html();
			if (typeof (children) == "undefined") {
				$(".zw-nav").parent().append("<ul style='display:none' id='topmenu-temp-hide'>" + html + "</ul>");
			}
			var nw = $(".navbar-collapse").outerWidth() - $(".container-fluid .navbar-right").outerWidth();
			var n = 0;
			$("#topmenu-temp-hide>li").each(function(i, dom) {
								var navw = 0;
								$(".zw-nav>li").each(function(i, r) {
									navw += $(r).outerWidth();
								});
								if (navw + 210 > nw) {
									var di = $(".zw-nav>li[class='dropdown']").html();
									if (typeof (di) == "undefined") {
										var lis = '<li class="dropdown">';
										lis += '<a href="#" class="dropdown-toggle" data-toggle="dropdown">其它模块 <span class="caret"></span></a>';
										lis += '<ul class="dropdown-menu" role="menu">';
										lis += '</ul>';
										lis += '</li>';
										$(".zw-nav").append(lis);
									}
									if ($(dom).hasClass("dropdown")) {
										$(dom).children("ul").find("li").each(function(m, v) {
											$(".zw-nav>li[class='dropdown']>ul").append('<li class="li-inline">'+ $(v).html()+ '</li>');
										});
									} else {
										$(".zw-nav>li[class='dropdown']>ul").append('<li class="li-inline">'+ $(dom).html() + '</li>');
									}
								} else {
									if ($(dom).hasClass("dropdown")) {
										$(dom).children("ul").find("li").each(function(m, v) {
											$(".zw-nav").append('<li>' + $(v).html()+ '</li>');
										});
									} else {
										$(".zw-nav").append('<li>' + $(dom).html() + '</li>');
									}
								}
							});
			$(".zw-nav li a[data-id='" + activeId + "']").parent().addClass("active");// 重新选中
			ZWMENU.topClickEven();// 点击事件 绑定
		},
		/*加载顶部菜单*/
		loadTop:function(){
			$.ajax({
				url : "sbr/sbr_find",
				type : "post",
				data : {
					type : "menu"
				},
				dataType : "json",
				success : function(result) {
					if (result.code == 1) {
						$("#navbar-collapse .zw-nav").empty();
						var data = result.data;
						for (var i = 0; i < data.length; i++) {
							var li = '<li>';
							li += '<a class="zw-nav-a" id="leftMeaueList" data-url="'
									+ data[i].resourceUrl
									+ '" data-id="' + data[i].resourceId
									+ '">';
							li += '<span class="color-palette-set"> ';
							li += '<span class="color-palette icon"><i class="'
									+ data[i].menuIcon + '"></i></span>';
							li += '<span class="color-palette title">'
									+ data[i].resourceName + '</span>';
							li += '</span>';
							li += '</a>';
							li += '</li>';
							$("#navbar-collapse .zw-nav").append(li);
						}
						ZWMENU.changeTopEven();// 默认加载一次
						$("#navbar-collapse>.zw-nav>li:nth-child(1)").click();// 默认选中第一个
					} else {
						Ewin.alert({"message":result.msg});
					}
				}
			});
		},
		/*加载左侧菜单*/
		loadLeft:function(data){
			var html = "";
			for (var i = 0; i < data.length; i++) {
				var children = data[i].sysBusinessResources;
				if(typeof children!="undefined"){
					html += children.length == 0 ? '<li id="leftMeaueName">' : '<li class="treeview">';
					html += '<a  data-id="' + data[i].resourceId + '" data-refType="'+data[i].refreshType+'" data-url="'
							+ data[i].resourceUrl + '" >';
					html += '<i class="' + data[i].menuIcon + '"></i> ';
					html += '<span>' + data[i].resourceName + '</span> ';
					html += children.length == 0 ? ''
							: '<span class="pull-right-container"><i class="fa fa-angle-left pull-right"></i></span>';
					html += '</a>';
					html += children.length == 0 ? '' : '<ul class="treeview-menu">';
					html += ZWMENU.loadLeft(children);
					html += children.length == 0 ? '' : '</ul>';
					html += '</li>';
				}
			}
			return html;
		},
		/*顶部菜单点击触发方法*/
		topClickEven:function(){
			$("#navbar-collapse>.zw-nav li").unbind("click");
			$("#navbar-collapse>.zw-nav li").on("click", function() {
				ZWMENU.topToLeftClickEven(this,"#left-menu-list>li>a","");
			});
		},
		/*顶部菜单点击触发左侧菜单点击触发方法*/
		topToLeftClickEven:function(o,p,m){
			$(o).addClass("active");
			$(o).siblings().removeClass("active");
			$(o).siblings().find("li").removeClass("active");
			var parentId = $(o).children("a").attr("data-id");
			var topUrl = $(o).children("a").attr("data-url");
			if(topUrl!=""&&typeof topUrl!="undefined"){
				//若需要顶部菜单直接跳转页面走这里
				layer.msg("正在跳转至"+$(o).children("a").text()+"...");
				$("#left-menu-list").empty();
				$("body").attr("class","skin-blue-light sidebar-mini fixed-zw sidebar-collapse");
				if(350==parentId){
					$.ajax({
						url : topUrl+'/SingleModule?username=admin&password=ca2924d86691a890bd96ad5e11620c4a#/app/WebMap',
						type : 'get',
						dataType : 'jsonp',
						async:false,
						error:function(){
							window.open(topUrl);
						}
					});
					return false;
				}
				//window.location.href = topUrl;
				window.open(topUrl);
				return false;
			}
			if (typeof (parentId) != "undefined" && parentId != "") {
				$("#left-menu-list").empty();// 清空左侧菜单栏
				if(Number(parentId)==0){
					$("#left-menu-list").html(localStorage.getItem('leftMenuLi'));
					ZWMENU.leftClickEven();
					return false;
				}
				// 加载左侧菜单栏 -START 
				$.ajax({
					url : "sbr/sbr_find",
					type : "post",
					data : {
						parentId : parentId
					},
					dataType : "json",
					success : function(result) {
						if (result.code == 1) {
							var data = result.data;
							if (data.length > 0) {
								$("#left-menu-list").html(ZWMENU.loadLeft(data));
								ZWMENU.leftClickEven();// 监听事件
								if(p!=""){
									$(p).eq(0).click();//默认选中第一个
								}
								if(m!=""){
									$(m).eq(0).click();//默认选中第一个
								}
							} else {
								$("#left-menu-list").html("没有数据！");
							}
						} else {
							Ewin.alert({"message":result.msg});
						}
					}
				});
				// 加载左侧菜单栏 -END
			}
		},
		/*左侧菜单点击触发方法*/
		/*左侧菜单点击触发方法*/
		leftClickEven:function(){
			$("#left-menu-list li[class!='treeview']>a").unbind("click");
			$("#left-menu-list li[class!='treeview']>a").on("click",function() {
						$("#left-menu-list").find("li[class='active']").removeClass("active");
						$(this).parent().addClass("active");
						$("#content-main").empty();// 清空内容
						var leftId = $(this).attr("data-id");
						var leftUrl = $(this).attr("data-url");
						$("#leftId").val(leftId);// 将点击的模块的id存放在index页面，方便主题内容页面刷新使用
						$("#refType").val($(this).attr("data-refType")); // 刷新方式存放主界面
						$(".workPositionDiv").empty();// 清空内容
						$("#content-main").css("top","0px");
						var thisNode = $(this);
						var getTimestamp=new Date().getTime();
						$.ajax({url : "workPosition/getWorkPositionPageTest",
							data:{"leftId":leftId,"timestamp":getTimestamp},
							success : function(result) {
									$(".workPositionDiv").html(result);
									if (!CommonUtil.isEmpty(leftId)&&!CommonUtil.isEmpty(leftUrl)) {
										$.ajax({url: "sbr/sbr_refreshType",
											data: {"leftId":leftId},
											success: function(result) {
												if(result.code!=1){
													Ewin.msg({type:"warning",content:resulr.msg})
													return false;
												}
												$.ajax({url: "sbr/sbr_com",
													data: {"leftId":leftId},
													success: function(result) {$("#content-main").html(result);}}); 
											}}); 
									}
							}
						});
					});
		}
}
/*监听容器的大小变化*/
$(".container-fluid").resize(function(e) {
	ZWMENU.changeTopEven();
});

ZWMENU.loadTop();//首次加载顶部导航