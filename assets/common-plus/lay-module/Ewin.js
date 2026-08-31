layui.define([ "element", "jquery", "layer" ], function(exports) {
	var element = layui.element, $ = layui.$, layer = layui.layer;
	var generateId = function() {
		var date = new Date();
		return 'mdl' + date.valueOf();
	}
	var Ewin = new function(){
		this.modal=function(options){
			options = $.extend({}, {
				modalId:generateId(),
				title : '模态框',
				url : '',
				width : 'auto',
				height : 'auto',
				data:{}
			}, options || {});
			var layerIndex=0;
			var area = [options.width=='auto'?'auto':options.width+'px', options.height=='auto'?'auto':options.height+'px']
			$.ajax({
				  url:options.url,
				  type:'get',
				  data:options.data,
				  async:false,
				  dataType:'html',
				  success:function(res){
					  layerIndex= layer.open({
						  type: 1,
						  resize:false,
						  id:options.modalId,
						  title:options.title,
						  skin: 'layui-layer-rim', //加上边框
						  area: area, //宽高
						  content: res
					  });
				  }
			  })
			  return layerIndex;
		};
	}
	exports('Ewin', Ewin);
});