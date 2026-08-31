var bodyHeight=document.documentElement.clientHeight;
var divHeight=bodyHeight-240;
//声明公用变量
var oWebControl;	
/** 用户个人中心 START */
$("#personalCenterBtn").on("click",function(){
	Ewin.modal({
	  	modalId:"personalCenterIndexEdit",
		title:"个人中心",
		url:"user/personal_center",
		headerClass:"zw-modal-header",
		top:100,
		drag:true,
		data:{
			userId:$("#currentUserIdIndex").val()
		}
	});
});
/** 用户个人中心 END */
/** 从缓存中取数据 */
function getValue(key) {// 
	var value;
	$.ajax({
		url : "workPosition/getValue",
		type : "post",	
		async : false,
		success : function(result) {
			var map =  result.data ;
			value=map[key];
		}
	});
	return value;
}
Number.prototype.toFixed = function (s) {
 
    var that = this, changenum, index;
 
    // 负数
    if (this < 0) {
        that = -that;
    }
 
    changenum = (parseInt(that * Math.pow(10, s) + 0.5) / Math.pow(10, s)).toString();
 
    index = changenum.indexOf(".");
 
    if (index < 0 && s > 0) {
 
        changenum = changenum + ".";
 
        for (var i = 0; i < s; i++) {
            changenum = changenum + "0";
        }
 
    } else {
 
        index = changenum.length - index;
 
        for (var i = 0; i < (s - index) + 1; i++) {
            changenum = changenum + "0";
        }
    }
 
    if (this < 0) {
        return -changenum;
    } else {
        return changenum;
    }
}
function zwFullScreen(){
	var element = document.documentElement;
	 if(element.requestFullscreen) {
		  element.requestFullscreen();
	 } else if(element.mozRequestFullScreen) {
		  element.mozRequestFullScreen();
	 } else if(element.webkitRequestFullscreen) {
		  element.webkitRequestFullscreen();
	 } else if(element.msRequestFullscreen) {
		  element.msRequestFullscreen();
	 }
}
function zwExitFullScreen(){
	 if(document.exitFullscreen) {
			document.exitFullscreen();
	  } else if(document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
	  } else if(document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
	  }
}
