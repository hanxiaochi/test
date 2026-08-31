(function($) {
	window.CommonUtil = function() {
		var curRequestPath  = window.document.location.href,
	 		pathName = window.document.location.pathname,
			ipAndPort = curRequestPath.indexOf(pathName),
			localhostPath = curRequestPath.substring(0,ipAndPort),
			projectName = pathName.substring(0,pathName.substr(1).indexOf('/')+1),
			basePath = localhostPath + projectName;//当前项目路径
		//验证方法（添加验证方法请添加到此处）：
		var verificationFun={
				"non-empty":function(val){
					console.log(val);
					var resultMsg = new Object();
					if(typeof val == "undefined" || val == null || val == ""){
						resultMsg.msg="不能为空";
						resultMsg.code=0;
				        return resultMsg;
				    }else{
				    	resultMsg.msg="验证通过";
						resultMsg.code=1;
				        return resultMsg;
				    }
				},
				"email":function(val){
					var resultMsg = new Object();
					var myReg = /^(\w-*\.*)+@(\w-?)+(\.\w{2,})+$/;
					if (!myReg.test(val)) {
						resultMsg.msg="必须为邮箱";
						resultMsg.code=0;
				        return resultMsg;
					}
					resultMsg.msg="验证通过";
					resultMsg.code=1;
			        return resultMsg;
				},
				"amount":function(val){
					var num=getValue("numDecimals");
					var resultMsg = new Object();
					if(val==""||val.length==0){
						resultMsg.msg="数量为空！";
						resultMsg.code=0;
						return resultMsg;
					}
					if(num==0||typeof(num)=="undefined"){
						num=1;
					}
					eval("var myReg= /^[+-]?\\d*\.?\\d{0," + num + "}$/;");
					if (!myReg.test(val)) {
						resultMsg.msg="数量不符合标准";
						resultMsg.code=0;
				        
					}else{
						resultMsg.msg="验证通过";
						resultMsg.code=1;
					}
					return resultMsg;
				},
				"unitPrice":function(val){
					var resultMsg = new Object();
					var num=getValue("priceDecimals");
					if(num==0||typeof(num)=="undefined"){
						num=1;
					}
					eval("var myReg= /^[+-]?\\d*\.?\\d{0," + num + "}$/;");
					if (!myReg.test(val)) {
						resultMsg.msg="价格不符合标准";
						resultMsg.code=0;
					}else{
						resultMsg.msg="验证通过";
						resultMsg.code=1;
					}
					 return resultMsg;
				},
				"money":function(val){
					var resultMsg = new Object();
					var num=getValue("moneyDecimals");
					if(num==0||typeof(num)=="undefined"){
						num=1;
					}
					eval("var myReg= /^[+-]?\\d*\.?\\d{0," + num + "}$/;");
					if (!myReg.test(val)) {
						resultMsg.msg="金额不符合标准";
						resultMsg.code=0;
					}else{
						resultMsg.msg="验证通过";
						resultMsg.code=1;
					}
						return resultMsg;
					},
				"date":function(val){var resultMsg = new Object();
					var arr = val.split("-");
		            if (arr.length == 3) {
		                intYear = parseInt(arr[0], 10);
		                intMonth = parseInt(arr[1], 10);
		                intDay = parseInt(arr[2], 10);
		                if (isNaN(intYear) || isNaN(intMonth) || isNaN(intDay)) {
		                	resultMsg.msg="时间格式错误";
							resultMsg.code=0;
					        return resultMsg;
		                }
		                if (intYear > 2100 || intYear < 1900 || intMonth > 12 || intMonth < 0 || intDay > 31 || intDay < 0) {
		                	resultMsg.msg="时间年份错误";
							resultMsg.code=0;
					        return resultMsg;
		                }
		                if ((intMonth == 4 || intMonth == 6 || intMonth == 9 || intMonth == 11) && intDay > 30) {
		                	resultMsg.msg="时间月份错误";
							resultMsg.code=0;
					        return resultMsg;
		                }
		                if (intYear % 100 == 0 && intYear % 400 || intYear % 100 && intYear % 4 == 0) {
		                    if (intDay > 29){
		                    	resultMsg.msg="时间日期错误";
								resultMsg.code=0;
						        return resultMsg;
		                    }
		                } else {
		                    if (intDay > 28){
		                    	resultMsg.msg="时间日期错误";
								resultMsg.code=0;
						        return resultMsg;
		                    }
		                }
		                resultMsg.msg="验证通过";
						resultMsg.code=1;
				        return resultMsg;
		            }else{
		            	resultMsg.msg="时间格式错误 正确为yyyy-MM-dd";
						resultMsg.code=0;
				        return resultMsg;
		            }
				},
				"isPoneAvailable": function (pone) {//判断是否是手机号
				  
					var resultMsg = new Object();
					var myreg = /^[1][3,4,5,7,8][0-9]{9}$/;
				    if (!myreg.test(pone)) {
				    	resultMsg.msg="手机号格式错误";
						resultMsg.code=0;
				        return resultMsg;
				    } else {
				    	resultMsg.msg="验证通过";
						resultMsg.code=1;
				        return resultMsg;
				    }
				 },
				  "isTelAvailable": function (tel) {// 判断是否为电话号码
					  var resultMsg = new Object();
					  var myreg = /^(([0\+]\d{2,3}-)?(0\d{2,3})-)(\d{7,8})(-(\d{3,}))?$/;
				    if (!myreg.test(tel)) {
				    	resultMsg.msg="电话号格式错误";
						resultMsg.code=0;
				        return resultMsg;
				    } else {
				    	resultMsg.msg="验证通过";
						resultMsg.code=1;
				        return resultMsg;
				    }
				  },"isNumber":function (val){//验证是否是数字
					  var myreg = /^-?[0-9]*(\.\d*)?$|^-?0(\.\d*)?$/;var resultMsg = new Object();
					    if (!myreg.test(val)) {
					    	resultMsg.msg="必须是数字";
							resultMsg.code=0;
					        return resultMsg;
					    } else {
					    	resultMsg.msg="验证通过";
							resultMsg.code=1;
					        return resultMsg;
					    }
				  },"password":function (val){var resultMsg = new Object();
					  var pattern = new RegExp("[`~!@#$^&*()=|{}':;',\\[\\].<>/?~！@#￥……&*（）——|{}【】‘；：”“'。，、？/\s+/g]");
					  if(pattern.test(val))
					  {
						  resultMsg.msg="密码格式有误";
						  resultMsg.code=0;
					      return resultMsg;
					  }else{
						  resultMsg.msg="验证通过";
							resultMsg.code=1;
					        return resultMsg;
					  }
				  }
				
		};
		return {verification : function(o) {//验证
				if ($(o).attr("data-verification") == null)// 若对象无检验属性 直接返回true
					return true;
				var ver = $(o).attr("data-verification").split(" ");
				if(ver=="")
					return true;
				var val = $(o).val();
				var boo = true;
				var msg = "";
				for (var i = 0; i < ver.length; i++) {
					var res = verificationFun[ver[i]](val);
					if(res.code==0){
						msg=res.msg;
						boo = false;
						continue;
					}
				}
				if(boo){
					 $(o).parent().removeClass("has-error");
		        }else{
		        	 $(o).parent().addClass("has-error");
		        	 $(o).val("");
		        	 $(o).attr("placeholder",msg);
		        }
				return boo;
			},verificationNew : function(o) {//验证
				var data = new Object();
				var boo = 0;
				$(o).each(function(){
					var name = $(this).attr("data-name");
					if (CommonUtil.verification(this)) {
						data[name] = $(this).val();
					}else{
						boo++;
						console.log(name);
					}
				});
				var icheck = new Object();
				icheck.boo = true;
				if(boo>0){
					icheck.boo = false;
				}else{
					icheck.data = data;
				}
				return icheck;
			},
			webPath:function(){//js 获取当前项目路径
		         return basePath;
			},
			isEmpty:function (obj){//判断字符串非空
				obj=obj.replace(/\s+/g,"");//去除字符串中的所有空格
			    if(typeof obj == "undefined" || obj == null || obj == ""){
			        return true;
			    }else{
			        return false;
			    }
			},
			isNumber:function (obj){//判断是否是数字
				if(obj==""){
					return false;
				}
				 var myreg = /^-?[0-9]*(\.\d*)?$|^-?0(\.\d*)?$/;
				  if (!myreg.test(obj)) {
				        return false;
				  } else {
				        return true;
				  }
			},
			autoHeight:function(o){//返回计算的高度
				try{
					var theDistance =$(window).height()-($(o).offset().top - $(window).scrollTop())-70;
					$(o).attr("style","overflow-x: auto; overflow-y: auto;");
					$(o).height(theDistance);
					return theDistance;
				}catch(err){
				}
			},
			fromInputVer:function(o){
				var data = new Object();
				var isCheck = true;
				if($(o).is(':hidden')){
					return false;
				}
				if(o!=""&&($(o+" .input-group>[data-name]").length>0)){
					$(o+" .input-group [data-name]").each(function() {
						var name = $(this).attr("data-name");
							if (CommonUtil.verification(this)) {
									data[name] = $(this).val();
							} else {
								isCheck = false;
							}
					});
				}else{
					isCheck = false;
				}
				return isCheck?data:false;
			},downloadFile:function(path){
				//$("#downloadIframe").attr("src",path)
				window.location.href=path;
			},scHtml:function (id,data){
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
		  },msToDate:function (time){
			    let datetime = new Date(time);
			    let year = datetime.getFullYear();
			    let month = datetime.getMonth();
			    let date = datetime.getDate();
			    let hour = datetime.getHours();
			    let minute = datetime.getMinutes();
			    let second = datetime.getSeconds();
			 
			    let result1 = year + 
			                 '-' + 
			                 ((month + 1) >= 10 ? (month + 1) : '0' + (month + 1)) + 
			                 '-' + 
			                 ((date + 1) < 10 ? '0' + date : date) + 
			                 ' ' + 
			                 ((hour + 1) < 10 ? '0' + hour : hour) +
			                 ':' + 
			                 ((minute + 1) < 10 ? '0' + minute : minute) + 
			                 ':' + 
			                 ((second + 1) < 10 ? '0' + second : second);
			 
			    let result2 = year + 
			                 '-' + 
			                 ((month + 1) >= 10 ? (month + 1) : '0' + (month + 1)) + 
			                 '-' + 
			                 ((date + 1) < 10 ? '0' + date : date);
			 
			    let result = {
			        hasTime: result1,
			        withoutTime: result2
			    };
			 
			    return result;
			}
		}
	}();
})(jQuery);

//解决js对浮点计算的精度问题  
var floatObj = function () {
	/**
	 * 用法
	 * 加法： floatObj.add(0.1, 0.2) 得到结果：0.3 
	 * 减法： floatObj.subtract(1, 0.9) 得到结果：0.1 
	 * 除法： floatObj.divide(2.2, 100) 得到结果：0.022 
	 * 乘法： floatObj.multiply(7, 0.8) 得到结果：5.6
	 */
	function add(num1, num2)  {
		num1 = Number(num1);
		num2 = Number(num2);
		var dec1, dec2, times;
		try {
			dec1 = countDecimals(num1) + 1;
		} catch (e) {
			dec1 = 0;
		}
		try {
			dec2 = countDecimals(num2) + 1;
		} catch (e) {
			dec2 = 0;
		}
		times = Math.pow(10, Math.max(dec1, dec2));
		// var result = (num1 * times + num2 * times) / times;
		var result = (accMul(num1, times) + accMul(num2, times)) / times;
		return getCorrectResult("add", num1, num2, result);
		// return result;
	};

	function subtract(num1, num2) {
		num1 = Number(num1);
		num2 = Number(num2);
		var dec1, dec2, times;
		try {
			dec1 = countDecimals(num1) + 1;
		} catch (e) {
			dec1 = 0;
		}
		try {
			dec2 = countDecimals(num2) + 1;
		} catch (e) {
			dec2 = 0;
		}
		times = Math.pow(10, Math.max(dec1, dec2));
		// var result = Number(((num1 * times - num2 * times) / times);
		var result = Number((accMul(num1, times) - accMul(num2, times)) / times);
		return getCorrectResult("sub", num1, num2, result);
		// return result;
	};

	function divide(num1, num2) {
		num1 = Number(num1);
		num2 = Number(num2);
		var t1 = 0, t2 = 0, dec1, dec2;
		try {
			t1 = countDecimals(num1);
		} catch (e) {
		}
		try {
			t2 = countDecimals(num2);
		} catch (e) {
		}
		dec1 = convertToInt(num1);
		dec2 = convertToInt(num2);
		var result = accMul((dec1 / dec2), Math.pow(10, t2 - t1));
		return getCorrectResult("div", num1, num2, result);
		// return result;
	};

	function accMul(num1, num2)  {
		num1 = Number(num1);
		num2 = Number(num2);
		var times = 0, s1 = num1.toString(), s2 = num2.toString();
		try {
			times += countDecimals(s1);
		} catch (e) {
		}
		try {
			times += countDecimals(s2);
		} catch (e) {
		}
		var result = convertToInt(s1) * convertToInt(s2) / Math.pow(10, times);
		return getCorrectResult("mul", num1, num2, result);
		// return result;
	};

	var countDecimals = function(num) {
		var len = 0;
		try {
			num = Number(num);
			var str = num.toString().toUpperCase();
			if (str.split('E').length === 2) { // scientific notation
				var isDecimal = false;
				if (str.split('.').length === 2) {
					str = str.split('.')[1];
					if (parseInt(str.split('E')[0]) !== 0) {
						isDecimal = true;
					}
				}
				var x = str.split('E');
				if (isDecimal) {
					len = x[0].length;
				}
				len -= parseInt(x[1]);
			} else if (str.split('.').length === 2) { // decimal
				if (parseInt(str.split('.')[1]) !== 0) {
					len = str.split('.')[1].length;
				}
			}
		} catch (e) {
			throw e;
		} finally {
			if (isNaN(len) || len < 0) {
				len = 0;
			}
			return len;
		}
	};

	var convertToInt = function(num) {
		num = Number(num);
		var newNum = num;
		var times = countDecimals(num);
		var temp_num = num.toString().toUpperCase();
		if (temp_num.split('E').length === 2) {
			newNum = Math.round(num * Math.pow(10, times));
		} else {
			newNum = Number(temp_num.replace(".", ""));
		}
		return newNum;
	};

	var getCorrectResult = function(type, num1, num2, result) {
		var temp_result = 0;
		switch (type) {
		case "add":
			temp_result = num1 + num2;
			break;
		case "sub":
			temp_result = num1 - num2;
			break;
		case "div":
			temp_result = num1 / num2;
			break;
		case "mul":
			temp_result = num1 * num2;
			break;
		}
		if (Math.abs(result - temp_result) > 1) {
			return temp_result;
		}
		return result;
	};
	
	
    return {
        add: add,
        subtract: subtract,
        multiply: accMul,
        divide: divide
    }
}();
