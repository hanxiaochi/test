layui.define([ "element", "jquery", "layer","zwUtil","util"],function(exports) {
	var element = layui.element, $ = layui.$, layer = layui.layer,zwUtil=layui.zwUtil,util=layui.util;
	var loadCurrUserInfoUrl="user/curr_user_info";//用户信息URL
	var defaultUserImg=zwUtil.defaultUserImg;//默认用户头像
	var tip_index=0;
	var zwOnline = new function() {
		    this.loadCurrUserInfo = function(){
	        	$.ajax({
					  url:loadCurrUserInfoUrl,
					  type:'get',
					  dataType:'json',
					  async:false,
					  success:function(res){
						  if(res.code==1){
							  var user = res.data;
							  $currUserId=user.userId;
							  $("[data-user-info] .zw-user-image").removeClass("layui-hide");
							  $("[data-user-info] .zw-user-image").attr("src",zwUtil.CheckImgExists(user.avatarPath)?user.avatarPath:defaultUserImg);
							  $("[data-user-info] .zw-user-name").text(user.userName);
							 // zwOnline.socket(user.userId);//打开webSocket
						  }
					  }
				  })
	        };
	        this.socket = function(userId){
	            var curWwwPath = window.document.location.href;
	            var ccc = curWwwPath.indexOf("#");
	            if(ccc>0){
	            	curWwwPath = curWwwPath.substring(0, ccc);
	            }
	        	var pathName = window.document.location.pathname;
	        	var pos = curWwwPath.indexOf(pathName);
	        	var localhostPath = curWwwPath.substring(0, pos);
	        	if(pathName=="/"){
	        		localhostPath=curWwwPath;
	        	}
	        	console.log(localhostPath);
	        	var socket;
				if (typeof (WebSocket) == "undefined") {
					console.log("您的浏览器不支持WebSocket");
				} else {
					console.log("您的浏览器支持WebSocket");
					// 实现化WebSocket对象，指定要连接的服务器地址与端口 建立连接
					// 等同于socket = new
					socket = new ReconnectingWebSocket(localhostPath.replace("http://","ws:")+"/websocket/pc/"+userId);
					// 打开事件
					socket.onopen = function() {
						console.log("Socket 已打开");
					// socket.send("这是来自客户端的消息" + location.href + new Date());
					};
					// 获得消息事件
					socket.onmessage = function(msg) {
						var result = JSON.parse(msg.data);
						console.log(result);
						if (result.code == 8) {//此处为服务器注销用户后刷新当前网页
							layer.alert(result.msg, function(index){
								window.location.reload();
								layer.close(index);
							});       
						}else if(result.code == 7){//上线下线提示
							if(typeof ($("#onlineList"))!="undefined"){
								zwOnline.loadUserOnlineList();
							}
							if(result.data.loginType=="app"&&Number(userId)==result.data.userId){
								layer.msg('手机端'+result.data.stateMsg);
							}
						}else if(result.code == 6){//请求消息
							var data = new Object();
							data.userName=result.other.userName;
							data.date=util.toDateString(new Date(), "yyyy年MM月dd日 HH:mm:ss");
							data.imgUrl=zwUtil.CheckImgExists(result.other.avatarPath)?result.other.avatarPath:zwUtil.defaultUserImg;
							data.text=result.data;
							if($("#lt-message-div"+result.other.userId).length>0){
								$("#lt-message-div"+result.other.userId+">div").append(zwUtil.scHtml("messageDefaultLeft",data));
								$("#lt-message-div"+result.other.userId+">div").stop().animate({
									scrollTop: $("#lt-message-div"+result.other.userId+">div")[0].scrollHeight
								}, 500);
							}else{
								if($("#onlineUserListModel").length>0){
									$('#onlineList>li[data-user="'+result.other.userId+'"]>a').addClass("blink");
								}else{
									$("#onlineUser").attr("class","blink");
								}
							}
						}
					};
					// 关闭事件
					socket.onclose = function() {
						console.log("Socket已关闭");
					};
					// 发生了错误事件
					socket.onerror = function() {
						console.log("Socket发生了错误");
						// 此时可以尝试刷新页面
						// window.location.reload();
					}
				}
	        };
	        this.loadUserOnlineList =function(){
	    		$.ajax({
	    				url : "online/list",
	    				type : "get",
	    				dataType : "json",
	    				success : function(result) {
	    					if(result.code==1){
	    						$("#onlineList").empty();
	    						dataUserOnlineList = result.data;
	    						for (var i=dataUserOnlineList.length-1;i>=0;i--){
	    							if(dataUserOnlineList[i].userOnline.userId!=$("#currentUserIdIndex").val()){
	    								var userImg = zwUtil.CheckImgExists(dataUserOnlineList[i].userOnline.pic)?dataUserOnlineList[i].userOnline.pic:defaultUserImg;
	    								var li = ' <li data-user="'+dataUserOnlineList[i].userOnline.userId+'" data-index="'+i+'" class="list-group-item">';
	    									li+='<img src="'+userImg+'" class="img-circle" alt="">';
	    									li+='<a class="zw-user-title">'+dataUserOnlineList[i].userOnline.username+'</a>';
	    									li+='<span class="pull-right">';
	    									if(dataUserOnlineList[i].userOnline.statusPc==1){
	    										li+='<i class="layui-icon layui-icon-website zw-text-success"></i>';
	    									}else{
	    										li+='<i class="layui-icon layui-icon-website text-muted"></i>';
	    									}
	    									if(dataUserOnlineList[i].userOnline.statusApp==1){
	    										li+='<i class="layui-icon layui-icon-cellphone zw-text-success"></i>';
	    									}else{
	    										li+='<i class="layui-icon layui-icon-cellphone text-muted"></i>';
	    									}
	    									li+='</span>';
	    									li+='</li>';
	    									$("#onlineList").append(li);
	    							}
	    						}
	    					}
	    				}
	    		});
	    	};
	}
	/*在线用户框*/
    $("body").on("click",'a[data-online-user]',function(){
    	$(this).attr("class","");
    	layui.use(['layer'],function() {
    		var title = '<i class="fa fa-users zw-text-success"></i> 在线用户列表';
    		$.ajax({
    			url : "common/onlineUser.html",
    			type : "get",
    			success : function(result) {
    				layer.open({
    					type: 1,
    					offset: 'rb',
    					title:title,
    					shadeClose: true,
    					shade: 0,
    					id:"onlineUserListModel",
    					area: ['258px','601px'],
    					skin: 'zw-online-model',
    					content:result
    				});
    			}
    		});
    	});
    });
    /*显示头像*/
    $('body').on('click','#onlineList li img',function(){
		var src = $(this).attr("src");
		layer.open({
			  type: 1,
			  title: false,
			  closeBtn: 0,
			  skin: 'layui-layer-nobg', //没有背景色
			  shadeClose: true,
			  content: '<img src="'+src+'">'
		});
	})
    /*点击列表弹出聊天框*/
    $('body').on('click','#onlineList li a',function(){
		var userOnline=dataUserOnlineList[$(this).parent().attr("data-index")].userOnline;
		if($("#currentUserIdIndex").val()==userOnline.userId){
			return false;
		}
		var src = $(this).attr("src");
		var userImg = zwUtil.CheckImgExists(userOnline.pic)?userOnline.pic:defaultUserImg
		$.ajax({
			url : "online/lt",
			type : "get",
			data:{userId:userOnline.userId},
			success : function(result) {
				layer.open({
					type: 1,
					id:"onlineUserLTModel"+userOnline.userId,
					title: '<img src="'+userImg+'" class="img-circle" style="height:25px;margin-right:10px" alt="">'+userOnline.username,
					shade: 0,
					resize:false,
					area: ['450px', '470px'], //宽高
					content: result
				});
			}
		});
		
	})
    /*鼠标漂浮至列表时显示用户登录信息*/
    $('body').on('mouseenter','#onlineList li',function(){
		  var userOnline=dataUserOnlineList[$(this).attr("data-index")].userOnline;
		  var str="";
			  if(userOnline.statusPc==1){
				  str+="<div><i class='layui-icon layui-icon-circle-dot zw-text-success'></i>PC上线时间：<p>"+userOnline.startTimestamp+"</p></div>";
				}else{
				  str+="<div><i class='layui-icon layui-icon-menu-fill text-muted'></i> PC离线</div>";
				}
			  	str+="<hr>";
				if(userOnline.statusApp==1){
					str+="<div><i class='layui-icon layui-icon-circle-dot zw-text-success'></i>APP上线时间：<p>"+userOnline.startTimestampApp+"</p></div>";
				}else{
					str+="<div><i class='layui-icon layui-icon-menu-fill text-muted'></i> APP离线</div>";
				}
		  	  str+="<hr>";
		  	  str+="<div>所属系统：<p>"+userOnline.clientName+"</p></div>";
		  	  str+="<hr>";
		  	  str+="<div>所属部门："+userOnline.deptName+"</div>";
		  	  str+="<hr>";
		  	  str+="<div>用户角色："+userOnline.roleTypeName+"</div>";
			  tip_index= layer.tips(str, this, {
	    		  tips: [2, '#3c8dbc'],time: 0
	    	  });
	  }).on('mouseleave','#onlineList li', function(){
	  	layer.close(tip_index);
	  });
	exports('zwOnline', zwOnline);
});