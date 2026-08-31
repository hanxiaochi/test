(function($) {
	window.Ewin = function() {
		var html = '<div id="[Id]" class="modal fade" role="dialog" aria-labelledby="modalLabel">'
				+ '<div class="modal-dialog modal-sm">'
				+ '<div class="modal-content">'
				+ '<div class="modal-header [DiyHeaderClass]">'
				+ '<button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">×</span><span class="sr-only">Close</span></button>'
				+ '<h4 class="modal-title" id="modalLabel">[Title]</h4>'
				+ '</div>'
				+ '<div class="modal-body">'
				+ '<p>[Message]</p>'
				+ '</div>'
				+ '<div class="modal-footer">'
				+ '<button type="button" class="btn btn-default cancel" data-dismiss="modal">[BtnCancel]</button>'
				+ '<button type="button" class="btn btn-primary ok" data-dismiss="modal">[BtnOk]</button>'
				+ '</div>' + '</div>' + '</div>' + '</div>';

		var dialogdHtml = '<div id="[Id]" class="modal fade" role="dialog" aria-labelledby="modalLabel">'
				+ '<div class="modal-dialog">'
				+ '<div class="modal-content">'
				+ '<div class="modal-header [DiyHeaderClass]">'
				+ '<button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">×</span><span class="sr-only">Close</span></button>'
				+ '<h4 class="modal-title" id="modalLabel">[Title]</h4>'
				+ '</div>'
				+ '<div class="modal-body">'
				+ '</div>'
				+ '</div>'
				+ '</div>' + '</div>';
		var modalHtml = '<div id="modal-[Id]" class="modal fade" data-backdrop="static"data-keyboard="false">';
			modalHtml += '<div class="modal-dialog">';
			modalHtml += '<div class="modal-content">';
			modalHtml += '<div class="modal-header [DiyHeaderClass]">';
			modalHtml += '<button type="button" class="close" data-dismiss="modal" aria-label="Close">';
			modalHtml += '	<span aria-hidden="true">&times;</span>';
			modalHtml += '</button>';
			modalHtml += '<h4 class="modal-title">[Title]</h4>';
			modalHtml += '</div>';
			modalHtml += '<div class="modal-body"></div>';
			modalHtml += '<div class="modal-footer [BTN]">';
			modalHtml += '<button type="button" class="btn btn-default" data-dismiss="modal">取消</button>';
			modalHtml += '<button type="button" data-type="submit" data-dismiss="modal" class="btn btn-primary">[SubmitText]</button>';
			modalHtml += '</div>';
			modalHtml += '</div>';
			modalHtml += '</div>';
			modalHtml += '</div>';
		var reg = new RegExp("\\[([^\\[\\]]*?)\\]", 'igm');
		var generateId = function() {
			var date = new Date();
			return 'mdl' + date.valueOf();
		}
		var init = function(options) {
			options = $.extend({}, {
				title : "操作提示",
				message : "提示内容",
				btnok : "确定",
				btncl : "取消",
				width : 200,
				auto : false,
				headerClass:""
			}, options || {});
			var modalId = generateId();
			var content = html.replace(reg, function(node, key) {
				return {
					Id : modalId,
					Title : options.title,
					Message : options.message,
					BtnOk : options.btnok,
					BtnCancel : options.btncl,
					DiyHeaderClass: options.headerClass
				}[key];
			});
			$('body').append(content);
			$('#' + modalId).modal({
				width : options.width,
				backdrop : 'static'
			});
			$('#' + modalId).on('hide.bs.modal', function(e) {
				$('body').find('#' + modalId).remove();
			});
			return modalId;
		}

		return {
			alert : function(options) {
				if (typeof options == 'string') {
					options = {
						message : options,
						closeFun : function (){
						}
					};
				}
				var id = init(options);
				var modal = $('#' + id);
				modal.find('.ok').removeClass('btn-success').addClass(
						'btn-primary');
				modal.find('.cancel').hide();
				modal.find('.modal-header button').hide();
				return {
					id : id,
					on : function(callback) {
						if (callback && callback instanceof Function) {
							modal.find('.ok').click(function() {
								callback(true);
							});
						}
					},
					hide : function(callback) {
						if (callback && callback instanceof Function) {
							modal.on('hide.bs.modal', function(e) {
								callback(e);
							});
						}
					}
				};
			},
			confirm : function(options) {
				var id = init(options);
				var modal = $('#' + id);
				/*
				 * modal.find('.ok').removeClass('btn-primary').addClass(
				 * 'btn-success');
				 */
				modal.find('.cancel').show();
				return {
					id : id,
					on : function(callback) {
						if (callback && callback instanceof Function) {
							modal.find('.ok').click(function() {
								callback(true);
							});
							modal.find('.cancel').click(function() {
								callback(false);
							});
						}
					},
					hide : function(callback) {
						if (callback && callback instanceof Function) {
							modal.on('hide.bs.modal', function(e) {
								callback(e);
							});
						}
					}
				};
			},
			modal : function(options) {
				options = $.extend({}, {
					modalId:generateId(),
					title : 'title',
					url : '',
					width : 600,
					height : 550,
					top:30,
					drag:false,
					html : '',
					headerClass:"",
					btn:"",
					submitText:"提交",
					data : {},
					submit : function() {
						return false;
					}
				}, options || {});
				Ewin.modalClose(options.modalId);
				var content = modalHtml.replace(reg, function(node, key) {
					return {
						Id : options.modalId,
						Title : options.title,
						DiyHeaderClass: options.headerClass,
						BTN: options.btn,
						SubmitText: options.submitText
					}[key];
				});
				$('body').append(content);
				var target = $('#modal-' + options.modalId);
				 $('#modal-' + options.modalId+">div").attr("style","height:"+options.height+"px;width:"+options.width+"px;margin-top:"+options.top+"px");
				var url = options.url;
				if (typeof (url) != "undefined" && url != "") {
					$.ajax({
						url : url,
						type : "get",
						data : options.data,
						success : function(result) {
							target.find('.modal-body').html(result);
						}
					});
				} else {
					target.find('.modal-body').html(
							typeof (options.html) != "undefinde" ? options.html
									: "");
				}
				target.modal();
				target.find('button[data-type="submit"]').unbind("click");
				target.find('button[data-type="submit"]').on('click',options.submit);
				if(options.drag){
					target.draggable(); //此方法依靠于jquery ui.js
				}
				target.find('button[data-dismiss="modal"]').on('click',function(e) {
					Ewin.modalClose(options.modalId);
				});
				target.find('button[class="close"]').on('click',function(){
					Ewin.modalClose(options.modalId);
				});
				return {
					"colse":function(){
						return Ewin.modalClose(options.modalId);//回调函数
					}
				}
			},
			modalClose:function(modalId){
				try{
					var target =  $('#modal-' + modalId);
					target.modal("hide");
					$('#modal-' + modalId).remove();
					$(".modal-backdrop.fade.in").remove();
					$(".skin-blue-light.sidebar-mini.fixed-zw").attr('style','height: auto; min-height: 100%;');
					$(".skin-blue-light.sidebar-mini.fixed-zw").removeClass("modal-open");
				}catch(err){
					console.log(err);
				}
				return {callback:function(fun){fun();}}//回调函数
			},
			modalSubmit:function(options){
				var target =  $('#modal-' + options.modalId+' button[data-type="submit"]');
				target.unbind("click");
				target.on('click',options.submit);
			},
			msg : function(options) {// 提示
				var className = "";
				var icon = "";
				switch (options.type) {
				case "danger":
					className = "alert-danger alert-dismissible";
					icon = "<span class='glyphicon glyphicon-remove-sign'></span>";
					break;
				case "warning":
					className = "alert-warning alert-dismissible";
					icon = "<span class='glyphicon glyphicon-question-sign'></span>";
					break;
				case "success":
					className = "alert-success alert-dismissible";
					icon = "<span class='glyphicon glyphicon-ok-sign'></span>";
					break;
				case "info":
					className = "alert-info alert-dismissible";
					icon = "<span class='glyphicon glyphicon-info-sign'></span>";
					break;
				}
				var div = '<div class="alert ' + className
						+ ' zw-alert" role="alert">';
				div += '<button type="button" class="close" data-dismiss="alert" aria-label="Close">';
				div += '<span aria-hidden="true">&times;</span></button>';
				div += icon;
				div += options.content;
				div += '</div>';
				$(".lay-zw-content-page>.alert").remove();
				$(".lay-zw-content-page").append(div);
				window.setTimeout(function() {
					$('.lay-zw-content-page>.alert [data-dismiss="alert"]').alert('close');
				}, 2500);
			},
			refreshBack:function(e){//
				var style='style="height:'+$(e).height()+'px;width:'+$(e).width()+'px"';
				var div='<div class="zw-refresh-back" data-refreshBack '+style+'><i class="fa fa-spin fa-refresh"></i></div>';
				try{
					$(e).children("div[data-refreshBack]").remove();
				}catch(err){
				}
				$(e).prepend(div);
				return {
					colse:function(){
						$(e).children("div[data-refreshBack]").remove();
					}
				}
			}
		}
	}();
})(jQuery);
