(function($){
	window.ZwTab = function (){
		var title='<li class="" title="[TITLENAME]" data-tabType="[TABTYPE]"><a href="#[CONTENTID]" data-toggle="tab" aria-expanded="false"><span>[TITLENAME]</span>[CLOSE]</a></li>';
		var tabContent='<div class="tab-pane" id="[CONTENTID]"></div>';
		var close='<i class="fa fa-close"></i>';
		var reg = new RegExp("\\[([^\\[\\]]*?)\\]", 'igm');
		var generateId = function() {
			var date = new Date();
			return 'zwtab' + date.valueOf();
		};
		function isJsonString(str) {
	        try {
	            if (typeof JSON.parse(str) == "object") {
	                return true;
	            }
	        } catch(e) {
	        }
	        return false;
	    }
		var tabInit='<ul class="nav nav-tabs zw-tab-title">';
				tabInit+='<li class="active" title="列表"><a href="#[CONTENTID]" data-toggle="tab" aria-expanded="true">[TITLENAME]</a></li>';
			tabInit+='</ul>';
			tabInit+='<div class="tab-content">';
				tabInit+='<div class="tab-pane active" id="[CONTENTID]">';
				tabInit+='</div>';
			tabInit+='</div>';
		return{
			init:function(options){
				options = $.extend({}, {
					title:"tab1",
					html:"没有内容",
					data:{}
				}, options || {});
				$("#"+options.id).attr("class","nav-tabs-custom zw-tab");
				$("#"+options.id).empty();
				var contentId = generateId();
				var url = options.url;
				var content = tabInit.replace(reg, function(node, key) {
					return {
						CONTENTID : contentId,
						TITLENAME : options.title
					}[key];
				});
				$("#"+options.id).html(content);
				if (typeof (url) != "undefined" && url != "") {
					$.ajax({
						url : url,
						type : "get",
						data : options.data,
						success : function(result) {
							$("#"+contentId).html(result);
						}
					});
				}else{
					$("#"+contentId).html(options.html);
				}
			},
			addTab:function(options){
				var len = $("#"+options.id+">.nav>li").length;
				if(len>9){
					Ewin.msg({type:"danger",content:"最多打开10个选项卡！"});
					return false;
				}
				options = $.extend({}, {
					closeBtn : true,
					title:"tab",
					html:"没有内容",
					url:"",
					type:null,
					data:{}
				}, options || {});
				
				if(options.type!=null&&options.type!=""&&$("#"+options.id+">.nav>li[data-tabType='"+options.type+"']").length>0){
					$("#"+options.id+">.nav>li[data-tabType='"+options.type+"']>a").tab('show');
					$("#"+options.id+">.nav>li[data-tabType='"+options.type+"']>a>span").text(options.title);
					ZwTab.getTab(options).reload(options);//重新加载
					return false;
				}
				var contentId = generateId();
				var nav = title.replace(reg, function(node, key) {
					return {
						CONTENTID : contentId,
						TITLENAME : options.title,
						TABTYPE:options.type,
						CLOSE: options.closeBtn==true?close:""
					}[key];
				});
				var url = options.url;
				var content = tabContent.replace(reg, function(node, key) {
					return {
						CONTENTID : contentId
					}[key];
				});
				$("#"+options.id+">.tab-content").append(content);
				$("#"+options.id+">.nav").append(nav);
				$("#"+options.id+">.nav a[href='#"+contentId+"']").tab('show');
				$("#"+options.id+">.nav a[href='#"+contentId+"']>i").on("click",function(){
					if($(this).parent().parent().hasClass("active")){
						$(this).parent().parent().prev().children("a").tab('show');
					}
					$("#"+options.id+">.tab-content>div[id='"+contentId+"']").remove();
					$(this).parent().parent().remove();
				});
				if (typeof (url) != "undefined" && url != "") {
					$.ajax({
						url : url,
						type : "get",
						async:false,
						data : options.data,
						success : function(result) {
							$("#"+contentId).html(result);
						}
					});
				}else{
					$("#"+contentId).html(options.html);
				}
				return {};
			},getTab:function(options){
				var e = $("#"+options.id+">.nav>li[data-tabType='"+options.type+"']");
				return {
					close:function(){
						$(e).find("i").click();
					},
					reload:function(op){
						op = $.extend({}, {
							html:"没有内容",
							data:{},
							url:""
						}, op || {});
						var contId = $(e).find("a").eq(0).attr("href");
						var url = op.url;
						if (typeof (url) != "undefined" && url != "") {
							$.ajax({
								url : url,
								type : "get",
								async:false,
								data : op.data,
								success : function(result) {
									if(isJsonString(JSON.stringify(result))){
										if(result.code==0){
											 $(e).find("i").click();
										}
									}else{
										$("#"+options.id+"  "+contId).html(result);
									}
								}
							});
						}else{
							$("#"+options.id+"  "+contId).html(op.html);
						}
						
					}
				}
			}
		}
	}()
})(jQuery);