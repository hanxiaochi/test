layui.define([ "element", "jquery", "layer" ],function(exports) {
	var element = layui.element, $ = layui.$, layer = layui.layer;
	var zwUtil = new function() {
		this.defaultUserImg="assets/common-plus/img/user/default-user.jpg";
		this.CheckImgExists = function(imgurl) {// 判断图片是否存在（ true存在 ， false不存在）
			if(imgurl==""){
				return false;
			}
			 var xmlHttp ;
		        if (window.ActiveXObject)
		         {
		          xmlHttp = new ActiveXObject("Microsoft.XMLHTTP");
		         }
		         else if (window.XMLHttpRequest)
		         {
		          xmlHttp = new XMLHttpRequest();
		         } 
		        xmlHttp.open("Get",imgurl,false);
		        xmlHttp.send();
		        if(xmlHttp.status==404)
		        return false;
		        else
		        return true;
		};
		this.scHtml=function (id,data){
		  	var h="";
			  var reg = new RegExp("\\[([^\\[\\]]*?)\\]", 'igm');
			h = $("#"+id).html().replace(reg, function(node, key) {
					return {
						userName : data.userName,
						date : data.date,
						imgUrl : data.imgUrl,
						text : data.text
					}[key];
				});
		  return h;
	  }
	}
	exports('zwUtil', zwUtil);
});